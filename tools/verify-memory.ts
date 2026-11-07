// Verifica la ventana de memoria (src/memoryPlan.ts): presupuesto según la RAM del dispositivo y qué se mantiene, carga y libera
// al recorrer un setlist de 10 canciones con presupuestos pequeños (400 MB), sin red ni navegador.
// Uso: node tools/verify-memory.ts
import { memoryBudgetBytes, planWindow, type MemoryConfig, type PlanSong } from "../src/memoryPlan.ts";

const MB = 1024 * 1024;
const CONFIG: MemoryConfig = { fraccion: 0.2, minMB: 600, maxMB: 1500, anteriores: 1, siguientes: 2, factorPico: 1.3 };

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

// ---- presupuesto ----
check("4 GB de RAM → 819 MB", Math.round(memoryBudgetBytes(4, CONFIG) / MB) === 819, `${Math.round(memoryBudgetBytes(4, CONFIG) / MB)} MB`);
check("2 GB de RAM → mínimo 600 MB", memoryBudgetBytes(2, CONFIG) === 600 * MB);
check("8 GB de RAM → tope 1500 MB", memoryBudgetBytes(8, CONFIG) === 1500 * MB);
check("sin dato de RAM se asume 4 GB", memoryBudgetBytes(undefined, CONFIG) === memoryBudgetBytes(4, CONFIG));
check("el presupuesto simulado manda", memoryBudgetBytes(8, CONFIG, 400) === 400 * MB);

// ---- simulación: recorrer un setlist avanzando ----
type Sim = { songs: PlanSong[] };
const makeSim = (count: number, mb: number): Sim => ({ songs: Array.from({ length: count }, (_, i) => ({ id: i + 1, cloud: true, loaded: false, bytes: mb * MB })) });
const used = (sim: Sim) => sim.songs.filter((s) => s.loaded).reduce((sum, s) => sum + s.bytes, 0);

/** Aplica el plan como lo hace la app: primero suelta, luego carga (todo lo que el plan pide, una tras otra, sin superar el presupuesto en ningún instante). */
function settle(sim: Sim, active: number, budget: number, preload = true) {
  let peak = used(sim);
  for (let guard = 0; guard < 50; guard++) {
    const plan = planWindow(sim.songs, active, budget, CONFIG, preload);
    for (const id of plan.release) sim.songs.find((s) => s.id === id)!.loaded = false;
    if (plan.load.length === 0) return { plan, peak };
    const song = sim.songs.find((s) => s.id === plan.load[0])!;
    peak = Math.max(peak, used(sim) + song.bytes); // durante la descarga ya ocupa lo que lleva
    song.loaded = true;
    peak = Math.max(peak, used(sim));
  }
  throw new Error("el plan no converge");
}

function walk(label: string, count: number, mb: number, budgetMB: number) {
  const sim = makeSim(count, mb);
  const budget = budgetMB * MB;
  let maxUsed = 0, maxPeak = 0, nextReady = 0;
  const steps: string[] = [];
  for (let active = 0; active < count; active++) {
    // al avanzar, la activa puede no estar cargada todavía (si no cupo precargarla): se carga en primer plano
    const { plan, peak } = settle(sim, active, budget);
    maxUsed = Math.max(maxUsed, used(sim));
    maxPeak = Math.max(maxPeak, peak);
    if (active + 1 < count && sim.songs[active + 1].loaded) nextReady++;
    const loaded = sim.songs.filter((s) => s.loaded).map((s) => s.id).join(",");
    steps.push(`#${active + 1}: cargadas [${loaded}] = ${Math.round(used(sim) / MB)} MB${plan.waiting ? ` · en espera #${plan.waiting}` : ""}`);
  }
  console.log(`\n${label}`);
  for (const line of steps) console.log("   " + line);
  return { maxUsed, maxPeak, nextReady, sim };
}

const big = walk("10 canciones de 300 MB, presupuesto 400 MB", 10, 300, 400);
check("300 MB × 10 con 400 MB: nunca se supera el presupuesto", big.maxPeak <= 400 * MB, `pico ${Math.round(big.maxPeak / MB)} MB`);
check("…solo cabe una a la vez: la siguiente queda en cola con aviso", big.nextReady === 0);

const mid = walk("10 canciones de 120 MB, presupuesto 400 MB", 10, 120, 400);
check("120 MB × 10 con 400 MB: nunca se supera el presupuesto", mid.maxPeak <= 400 * MB, `pico ${Math.round(mid.maxPeak / MB)} MB`);
check("…la precarga funciona: la siguiente ya está lista al llegar su turno", mid.nextReady >= 8, `${mid.nextReady} de 9`);
check("…al avanzar se liberan las que quedan fuera de la ventana", mid.sim.songs.filter((s) => s.loaded).length <= 3, `${mid.sim.songs.filter((s) => s.loaded).length} cargadas al final`);

const typical = walk("10 canciones de 142 MB (mediana de la biblioteca), presupuesto de un celular de 4 GB (819 MB)", 10, 142, 819);
check("142 MB × 10 con 819 MB: ventana de 4 (anterior, activa y 2 siguientes) = 568 MB", typical.maxUsed === 4 * 142 * MB, `máximo ${Math.round(typical.maxUsed / MB)} MB`);
check("…nunca se supera el presupuesto", typical.maxPeak <= 819 * MB, `pico ${Math.round(typical.maxPeak / MB)} MB`);

// ---- reglas sueltas ----
{
  const sim = makeSim(10, 100);
  settle(sim, 5, 600 * MB);
  const loadedIds = sim.songs.filter((s) => s.loaded).map((s) => s.id);
  check("en la mitad del setlist se mantienen anterior, activa y 2 siguientes (ids 5, 6, 7 y 8)", loadedIds.join(",") === "5,6,7,8", loadedIds.join(","));
  // retroceder a una ya liberada: vuelve a cargarla
  settle(sim, 0, 600 * MB);
  check("al retroceder a una canción liberada, se vuelve a cargar", sim.songs[0].loaded);
  check("…y salen de la ventana las lejanas", !sim.songs[5].loaded && !sim.songs[6].loaded);
}
{
  const sim = makeSim(5, 100);
  settle(sim, 1, 600 * MB, false);
  const ids = sim.songs.filter((s) => s.loaded).map((s) => s.id);
  check("con «Precargar siguiente» apagado no se carga la siguiente", !ids.includes(3) && ids.includes(2));
}
{
  const sim = makeSim(3, 100);
  sim.songs[1].cloud = false; // «Este dispositivo»: no cuenta ni se libera
  sim.songs[1].loaded = true;
  const plan = planWindow(sim.songs, 0, 300 * MB, CONFIG, true);
  check("las canciones de «Este dispositivo» no se liberan ni cuentan en el presupuesto", !plan.release.includes(2) && plan.used <= 200 * MB, `usado ${Math.round(plan.used / MB)} MB`);
}
{
  const sim = makeSim(3, 900);
  const plan = planWindow(sim.songs, 0, 400 * MB, CONFIG, true);
  check("una activa mayor que el presupuesto se carga igual (sola)", plan.keep.length === 1 && plan.keep[0] === 1 && plan.load[0] === 1);
}
{
  const songs: PlanSong[] = [{ id: 1, cloud: true, loaded: true, bytes: 100 * MB }];
  const plan = planWindow(songs, -1, 400 * MB, CONFIG, true);
  check("sin canción activa se libera todo", plan.release.length === 1 && plan.keep.length === 0);
}

console.log(failed ? `\n${failed} comprobación(es) fallaron` : "\nTodo en orden");
process.exit(failed ? 1 : 0);
