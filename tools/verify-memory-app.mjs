// Prueba de la ventana de memoria con la app real (modo desarrollo, nube falsa «dev://»): presupuesto simulado, precarga, liberación,
// retroceso, reintentos de red y que el audio de la canción activa no se interrumpe mientras se precarga.
// Uso: node tools/verify-memory-app.mjs [puerto=9334]   (requiere `npm run dev` y Chrome/Edge con --remote-debugging-port=<puerto>)
// No forma parte de `npm run verify`.
const port = Number(process.argv[2] ?? 9334);
const MB = 1048576;
const target = await (await fetch(`http://localhost:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (event) => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails));
  return r.result?.result?.value;
};
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`); };
const mem = () => ev("window.__mem()");
const until = async (cond, label, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await sleep(150); } console.log("   (tiempo agotado esperando: " + label + ")"); return false; };
const clickLabel = (label) => ev(`[...document.querySelectorAll('.icon-btn')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)})?.click(); 0`);

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 915, height: 412, deviceScaleFactor: 1, mobile: false });

async function open(budgetMB, extra = "") {
  await send("Page.navigate", { url: `http://localhost:5173/?budgetMB=${budgetMB}${extra}` });
  await sleep(4000);
  await ev(`document.querySelector('.splash, [class*=splash]')?.click(); 0`);
  await ev(`window.__peak = 0; window.__sampler && clearInterval(window.__sampler); window.__sampler = setInterval(() => { const m = window.__mem(); window.__peak = Math.max(window.__peak, m.used + m.inflight); }, 40); 0`);
}
const peakMB = async () => Math.round((await ev("window.__peak")) / MB);
const loadedIds = async () => (await mem()).songs.map((s, i) => (s.loaded ? i + 1 : null)).filter(Boolean).join(",");

// ===== A) 10 canciones de 300 MB con presupuesto de 400 MB =====
console.log("\n== A) 10 canciones de 300 MB, presupuesto 400 MB ==");
await open(400);
await ev("window.__demoCloud(10, 300); 0");
check("el setlist acepta las 10 como referencias", (await mem()).songs.length === 10);
await until(async () => (await mem()).songs[0].loaded, "canción 1 cargada");
let m = await mem();
check("la activa (1) se carga en primer plano", m.songs[0].loaded && m.used === 300 * MB, `usado ${Math.round(m.used / MB)} MB de ${Math.round(m.budget / MB)} MB`);
await sleep(1500);
m = await mem();
check("la siguiente no cabe junto a la actual: queda en cola (no se descarga)", !m.songs[1].loaded && m.downloading === -1);
check("aviso discreto «Siguiente en cola…»", await ev(`/Siguiente en cola/.test(document.body.innerText)`));
const series = [Math.round(m.used / MB)];
for (let step = 2; step <= 4; step++) {
  await clickLabel("Canción siguiente");
  await until(async () => (await mem()).songs[step - 1].loaded, `canción ${step} cargada`);
  await sleep(600);
  m = await mem();
  series.push(Math.round(m.used / MB));
  check(`al avanzar a la ${step} se libera la anterior y solo queda 1 cargada`, (await loadedIds()) === String(step), `cargadas: ${await loadedIds()}`);
}
check("memoria cargada tras cada avance (MB): " + series.join(" → "), series.every((v) => v === 300));
check("el presupuesto (400 MB) nunca se superó (incluye lo recibido en la descarga)", (await peakMB()) <= 400, `pico ${await peakMB()} MB`);

// ===== B) 10 canciones de 120 MB con presupuesto de 400 MB: precarga, liberación, retroceso, red =====
console.log("\n== B) 10 canciones de 120 MB, presupuesto 400 MB ==");
await open(400);
await ev("window.__demoCloud(10, 120); 0");
// en cuanto la 1 esté lista se pone a sonar; mientras suena se precargan la 2 y la 3 (con un fallo de red en medio)
await until(async () => ev(`!document.querySelector(".play-btn")?.disabled && document.querySelector(".play-btn")?.getAttribute("aria-label") === "Reproducir" && window.__mem().songs[0].loaded`), "canción 1 lista para sonar");
await ev("window.__devNet.failNext = 1; 0"); // el primer intento de precarga (la 2) falla una vez, como una caída de red
await ev(`document.querySelector(".play-btn")?.click(); 0`);
const clock = async () => ev(`document.querySelector(".clock strong")?.textContent`);
let maxStalled = 0, last = await clock(), stalled = 0, playingAll = true, advanced = false;
for (let t = 0; t < 120 && (await loadedIds()) !== "1,2,3"; t++) {
  await sleep(500);
  if (!(await ev(`document.querySelector(".play-btn")?.getAttribute("aria-label") === "Pausar"`))) playingAll = false;
  const now = await clock();
  if (now !== last) { advanced = advanced || now > last; last = now; stalled = 0; } else maxStalled = Math.max(maxStalled, ++stalled);
}
m = await mem();
check("precarga en segundo plano: quedan cargadas la activa y las 2 siguientes", (await loadedIds()) === "1,2,3", `usado ${Math.round(m.used / MB)} MB`);
check("el audio de la activa siguió sonando durante las precargas y el fallo de red", playingAll && advanced, `sin parar; reloj: ${last}`);
check("el reloj nunca se detuvo más de 1,5 s mientras se descargaba", maxStalled <= 3, `máximo ${maxStalled * 0.5} s sin avanzar`);
check("la precarga reintentó tras el fallo de red", await ev(`window.__devNet.log.some((l) => l.startsWith("fallo"))`));
await ev(`document.querySelector(".play-btn")?.click(); 0`); // pausa
await clickLabel("Canción siguiente");
await until(async () => (await mem()).activeIndex === 1, "activa = 2");
await clickLabel("Canción siguiente");
await until(async () => (await mem()).activeIndex === 2, "activa = 3");
await until(async () => (await loadedIds()).includes("4"), "precarga de la 4 (con un fallo de red en medio)", 90000);
m = await mem();
const ids = await loadedIds();
check("tras avanzar a la 3 se libera la 1 y se precarga la 4 (ventana 2,3,4)", ids === "2,3,4", `cargadas: ${ids}, usado ${Math.round(m.used / MB)} MB`);
await clickLabel("Canción anterior");
await clickLabel("Canción anterior");
await until(async () => { const x = await mem(); return x.activeIndex === 0 && x.songs[0].loaded; }, "volver a la 1 y recargarla", 90000);
check("al retroceder a una liberada, se vuelve a cargar", (await mem()).songs[0].loaded, `cargadas: ${await loadedIds()}`);
await sleep(3000);
check("el presupuesto (400 MB) nunca se superó (incluye lo recibido en la descarga)", (await peakMB()) <= 400, `pico ${await peakMB()} MB`);

// ===== C) precarga apagada =====
console.log("\n== C) «Precargar siguiente canción» apagado ==");
await open(400);
await ev(`localStorage.setItem('crescendo.precargar.v1', '0'); 0`);
await send("Page.reload");
await sleep(4000);
await ev("window.__demoCloud(4, 100); 0");
await until(async () => (await mem()).songs[0].loaded, "canción 1 cargada");
await sleep(4000);
check("sin precarga, la siguiente no se descarga hasta elegirla", (await loadedIds()) === "1", `cargadas: ${await loadedIds()}`);
await ev(`localStorage.removeItem('crescendo.precargar.v1'); 0`);

console.log(failed ? `\n${failed} comprobación(es) fallaron` : "\nTodo en orden");
await fetch(`http://localhost:${port}/json/close/${target.id}`);
ws.close();
process.exit(failed ? 1 : 0);
