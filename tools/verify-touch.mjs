// Prueba los gestos táctiles del mezclador con toques REALES simulados (CDP Input.dispatchTouchEvent) en un Chrome/Edge sin cabeza.
// Uso: node tools/verify-touch.mjs [url=http://localhost:5173/?demo] [puerto=9334]
// Requiere el servidor de desarrollo y un navegador con --remote-debugging-port=<puerto> (ver HANDOFF.md). No forma parte de `npm run verify`.
const [url = "http://localhost:5173/?demo", portArg = "9334"] = process.argv.slice(2);
const port = Number(portArg);

const target = await (await fetch(`http://localhost:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
});
const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evalIn = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails));
  return response.result?.result?.value;
};

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 915, height: 412, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url });
await sleep(6000);
await evalIn(`document.querySelector('.splash, [class*=splash]')?.click(); 0`);
await sleep(1500);

// --- toques ---
async function touch(type, x, y) {
  await send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
}
/** Gesto: toca en (x,y), espera `hold` ms, se mueve en `steps` pasos hasta (x+dx,y+dy) y suelta. */
async function gesture(x, y, dx, dy, { hold = 0, steps = 12, stepMs = 16 } = {}) {
  await touch("touchStart", x, y);
  if (hold) await sleep(hold);
  for (let i = 1; i <= steps; i++) { await touch("touchMove", x + (dx * i) / steps, y + (dy * i) / steps); await sleep(stepMs); }
  await touch("touchEnd", x + dx, y + dy);
  await sleep(350);
}

const snapshot = () => evalIn(`(() => ({
  faders: [...document.querySelectorAll('.fader')].map((e) => e.getAttribute('aria-valuenow')),
  pans: [...document.querySelectorAll('.pan-bar')].map((e) => e.getAttribute('aria-valuenow')),
  scroll: Math.round(document.querySelector('.mx-main').scrollLeft),
}))()`);
const centerOf = (selector, index = 0) => evalIn(`(() => { const r = document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top, left: r.left }; })()`);
const resetScroll = async () => { await evalIn(`document.querySelector('.mx-main').scrollLeft = 0; 0`); await sleep(200); };

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? ` · ${detail}` : ""}`); };
const same = (a, b) => JSON.stringify(a.faders) === JSON.stringify(b.faders) && JSON.stringify(a.pans) === JSON.stringify(b.pans);

const channelCount = await evalIn(`document.querySelectorAll('.mx-main .channel').length`);
console.log(`Canales en la lista: ${channelCount}`);

// (a) swipe horizontal empezando sobre cada parte del canal 0: la lista se desplaza y NINGÚN valor cambia
const parts = [
  ["cabeza del fader", async () => centerOf(".mx-main .fader-cap")],
  ["carril (arriba de la cabeza)", async () => { const r = await centerOf(".mx-main .fader-rail"); return { x: r.x, y: r.top + 12 }; }],
  ["carril (abajo)", async () => { const r = await centerOf(".mx-main .fader-rail"); return { x: r.x, y: r.top + r.h - 12 }; }],
  ["paneo (barra)", async () => centerOf(".mx-main .pan-bar")],
  ["medidor", async () => centerOf(".mx-main .channel-meter")],
  ["nombre", async () => centerOf(".mx-main .channel-name")],
];
for (const [label, locate] of parts) {
  await resetScroll();
  const before = await snapshot();
  const p = await locate();
  await gesture(p.x, p.y, -180, 0);
  const after = await snapshot();
  check(`(a) swipe horizontal sobre ${label}: la lista se desplaza`, after.scroll > before.scroll + 40, `scroll ${before.scroll} → ${after.scroll}`);
  check(`(a) swipe horizontal sobre ${label}: ningún valor cambia`, same(before, after));
}
// también hacia la derecha, y con un poco de deriva vertical (diagonal suave)
await evalIn(`document.querySelector('.mx-main').scrollLeft = 300; 0`); await sleep(200);
{
  const before = await snapshot();
  const visible = await evalIn(`[...document.querySelectorAll('.mx-main .fader-cap')].findIndex((e) => { const r = e.getBoundingClientRect(); return r.left > 120 && r.right < 700; })`);
  const p = await centerOf(".mx-main .fader-cap", visible);
  await gesture(p.x, p.y, 140, 14);
  const after = await snapshot();
  check("(a) swipe hacia la derecha con deriva vertical leve sobre la cabeza: la lista se desplaza", after.scroll < before.scroll - 40, `scroll ${before.scroll} → ${after.scroll}`);
  check("(a) … y ningún valor cambia", same(before, after));
}

// (b) arrastre vertical sobre un fader: el volumen cambia (arriba sube, abajo baja)
await resetScroll();
{
  const before = await snapshot();
  const p = await centerOf(".mx-main .fader-cap");
  await gesture(p.x, p.y, 0, -50);
  const up = await snapshot();
  check("(b) arrastre vertical hacia arriba: el volumen sube", Number(up.faders[0]) > Number(before.faders[0]), `${before.faders[0]} → ${up.faders[0]}`);
  check("(b) … y la lista no se desplazó", up.scroll === before.scroll);
  const p2 = await centerOf(".mx-main .fader-cap");
  await gesture(p2.x, p2.y, 0, 40);
  const down = await snapshot();
  check("(b) arrastre vertical hacia abajo: el volumen baja", Number(down.faders[0]) < Number(up.faders[0]), `${up.faders[0]} → ${down.faders[0]}`);
  check("(b) … y los demás faders no cambiaron", JSON.stringify(down.faders.slice(1)) === JSON.stringify(before.faders.slice(1)));
}

// (b2) arrastre casi vertical con deriva horizontal pequeña: sigue siendo del fader
{
  const before = await snapshot();
  const p = await centerOf(".mx-main .fader-cap");
  await gesture(p.x, p.y, 6, -45);
  const after = await snapshot();
  check("(b2) arrastre vertical con deriva horizontal leve: el volumen cambia", after.faders[0] !== before.faders[0] && after.scroll === before.scroll, `${before.faders[0]} → ${after.faders[0]}`);
}

// (c) toque corto sobre el carril: sin saltos de volumen
{
  const rail = await centerOf(".mx-main .fader-rail");
  for (const [label, y] of [["arriba del carril", rail.top + 6], ["mitad", rail.y], ["abajo", rail.top + rail.h - 6]]) {
    const before = await snapshot();
    await touch("touchStart", rail.x, y); await sleep(60); await touch("touchEnd", rail.x, y); await sleep(300);
    const after = await snapshot();
    check(`(c) toque corto en ${label} del carril: sin cambio de volumen`, same(before, after), `${before.faders[0]} → ${after.faders[0]}`);
  }
}

// (d) paneo: deslizamiento inmediato = lista (valor intacto); mantener ~300 ms y arrastrar = cambia el paneo y la lista no se mueve
await resetScroll();
{
  const p = await centerOf(".mx-main .pan-bar");
  const before = await snapshot();
  await gesture(p.x + 30, p.y, -120, 0);
  const after = await snapshot();
  check("(d) deslizamiento inmediato sobre el paneo: el paneo no cambia", same(before, after) && after.scroll > before.scroll, `paneo ${before.pans[0]} → ${after.pans[0]}, scroll ${before.scroll} → ${after.scroll}`);
  await resetScroll();
  const b2 = await snapshot();
  await gesture(p.x - 20, p.y, 30, 0, { hold: 320 });
  const a2 = await snapshot();
  check("(d) mantener y arrastrar el paneo: cambia el paneo y la lista no se desplaza", a2.pans[0] !== b2.pans[0] && a2.scroll === b2.scroll, `paneo ${b2.pans[0]} → ${a2.pans[0]}, scroll ${b2.scroll} → ${a2.scroll}`);
  check("(d) … y ningún fader cambió", JSON.stringify(a2.faders) === JSON.stringify(b2.faders));
}

await send("Target.closeTarget", { targetId: target.id });
ws.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} comprobación(es) con FALLA de ${results.length}` : `\nTodo en orden (${results.length} comprobaciones)`);
process.exit(failed ? 1 : 0);
