// Nivel 3: canción PEDIDA frente a ACTIVA. La que suena no se corta mientras se descarga la pedida, y la memoria sigue en presupuesto.
// Uso: node tools/verify-song-switch.ts
import { planWindow, type PlanSong } from "../src/memoryPlan.ts";
import { decideSwitch, fitsAlongside, onRequestedLoaded, requestedCanStart } from "../src/songSwitch.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};
const MB = 1048576;
const config = { anteriores: 1, siguientes: 1, factorPico: 1.3, precargaMaxMB: 800 };

// Decisión al elegir
check("elegir una ya cargada: se monta ahora (como siempre)", decideSwitch({ targetLoaded: true, targetCloud: true, mounted: true }) === "load-now");
check("elegir una de «Este dispositivo»: se monta ahora", decideSwitch({ targetLoaded: false, targetCloud: false, mounted: true }) === "load-now");
check("elegir una NO cargada con otra montada: queda pedida y la actual sigue", decideSwitch({ targetLoaded: false, targetCloud: true, mounted: true }) === "request");
check("elegir una NO cargada sin nada montado: activa y se descarga", decideSwitch({ targetLoaded: false, targetCloud: true, mounted: false }) === "replace");

// Memoria
check("142 MB sonando + 142 MB pedida con 819 MB: caben", fitsAlongside(142 * MB, 142 * MB, 819 * MB, 1.3));
check("700 MB sonando + 500 MB pedida con 819 MB: no caben", !fitsAlongside(700 * MB, 500 * MB, 819 * MB, 1.3));
check("la montada local no cuenta (0 bytes)", fitsAlongside(0, 600 * MB, 819 * MB, 1.3));
check("no caben y suena: la pedida ESPERA (no se corta nada)", requestedCanStart({ fits: false, playing: true, paused: false }) === "wait");
check("no caben y está en pausa: espera (no se pierde la pausa)", requestedCanStart({ fits: false, playing: false, paused: true }) === "wait");
check("no caben y detenida: se suelta la montada y se descarga", requestedCanStart({ fits: false, playing: false, paused: false }) === "replace");
check("caben: empieza ya", requestedCanStart({ fits: true, playing: true, paused: false }) === "start");

// Fin de la descarga
check("termina mientras suena la actual: NO se monta (queda lista)", onRequestedLoaded({ playing: true, paused: false }) === "hold");
check("termina en pausa: no se monta", onRequestedLoaded({ playing: false, paused: true }) === "hold");
check("termina con todo detenido: se monta", onRequestedLoaded({ playing: false, paused: false }) === "mount");

// Ventana de memoria con la montada fijada
const songs = (n: number, mb: number, loaded: number[] = []): PlanSong[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, cloud: true, loaded: loaded.includes(i + 1), bytes: mb * MB }));
{
  // Suena la 2 (cargada); se pide la 6 (lejos). La 2 no se suelta y su tamaño cuenta.
  const list = songs(10, 142, [2, 3]);
  const plan = planWindow(list, 5, 819 * MB, config, true, 1);
  check("pedida lejos: la que suena se conserva (no se libera)", plan.keep.includes(2) && !plan.release.includes(2), `keep ${plan.keep.join(",")}`);
  check("…la pedida se descarga primero", plan.load[0] === 6);
  check("…la vieja siguiente (3) se libera para hacer sitio", plan.release.includes(3));
  check("…la memoria planeada cuenta la que suena", plan.used >= 2 * 142 * MB);
}
{
  // Con poca memoria la precarga de la siguiente de la pedida no entra (la montada ocupa su sitio).
  const list = songs(10, 300, [2]);
  const plan = planWindow(list, 5, 819 * MB, config, true, 1);
  check("poca memoria: no se adelanta la siguiente de la pedida mientras la actual siga montada", !plan.load.includes(7), `load ${plan.load.join(",")}`);
}
{
  // La pedida es la siguiente inmediata: la montada (anterior) no se cuenta dos veces.
  const list = songs(5, 100, [2]);
  const plan = planWindow(list, 2, 819 * MB, config, true, 1);
  check("pedida = siguiente: la montada no se cuenta dos veces", plan.keep.filter((id) => id === 2).length === 1);
}
{
  // Sin fijar (comportamiento anterior) nada cambia
  const list = songs(10, 142, [2, 3]);
  const a = planWindow(list, 2, 819 * MB, config, true);
  const b = planWindow(list, 2, 819 * MB, config, true, 2);
  check("fijar la propia activa no cambia nada", JSON.stringify(a) === JSON.stringify(b));
}

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
