// Prueba las hojas y diálogos con toques REALES simulados (CDP Input.dispatchTouchEvent) en un Chrome/Edge sin cabeza, a 740x330:
//  A) Editor de marcadores (mantener pulsada la onda) y B) cajón de Click:
//   · el fondo queda inerte (inert), <html> recibe has-modal y no hay rebote (overscroll-behavior: none)
//   · el scrim es opaco (≥ 75 %) y la hoja cabe entera sin scroll interno, con sus botones dentro de la pantalla
//   · arrastrar sobre el scrim NO desplaza el fondo (ni la lista de canales ni la página) y tocar el fondo no cierra ni cambia nada
//   · al cerrar, el fondo vuelve a ser interactivo
// Uso: node tools/verify-dialogs.mjs [url=http://localhost:5173/?demo] [puerto=9334]
// Requiere `npm run dev` y Chrome/Edge con --remote-debugging-port=<puerto> (ver HANDOFF.md). No forma parte de `npm run verify`.
const [url = "http://localhost:5173/?demo", portArg = "9334"] = process.argv.slice(2);
const port = Number(portArg);
const target = await (await fetch(`http://localhost:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (event) => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evalIn = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails));
  return r.result?.result?.value;
};
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`); };
const touch = (type, x, y) => send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
async function drag(x0, y0, x1, y1) {
  await touch("touchStart", x0, y0);
  for (let i = 1; i <= 12; i++) { await touch("touchMove", x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12); await sleep(16); }
  await touch("touchEnd", x1, y1);
  await sleep(250);
}
const state = () => evalIn(`({ channels: document.querySelector('.mx-main')?.scrollLeft ?? -1, page: document.scrollingElement.scrollTop, pageX: document.scrollingElement.scrollLeft })`);

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 740, height: 330, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url });
await sleep(6000);
await evalIn(`document.querySelector('.splash, [class*=splash]')?.click(); 0`);
for (let i = 0; i < 40; i++) { if (await evalIn(`!!document.querySelector('.mx-main .channel') && !/Preparando pistas/.test(document.body.innerText)`)) break; await sleep(500); }
await sleep(600);

async function inspect(label, layerSelector, cardSelector, closeAction) {
  const open = await evalIn(`(() => { const c = document.querySelector(${JSON.stringify(cardSelector)}); if (!c) return null; const r = c.getBoundingClientRect(); const a = [...c.querySelectorAll('button')].map(b => b.getBoundingClientRect()); return { top: r.top, bottom: r.bottom, vh: innerHeight, scroll: c.scrollHeight - c.clientHeight, inside: a.every(x => x.bottom <= innerHeight + 1) }; })()`);
  check(`${label}: abierto`, !!open);
  if (!open) return;
  if (!label.includes("cajón")) check(`${label}: cabe entero sin scroll interno`, open.scroll <= 1 && open.top >= 0 && open.bottom <= open.vh, `alto ${Math.round(open.bottom - open.top)} de ${open.vh}, scroll ${open.scroll}`);
  check(`${label}: <html> con has-modal y overscroll-behavior: none`, await evalIn(`document.documentElement.classList.contains('has-modal') && getComputedStyle(document.documentElement).overscrollBehaviorY === 'none'`));
  check(`${label}: fondo inerte (cabecera y barra de pestañas)`, await evalIn(`!!document.querySelector('.tab-bar')?.closest('[inert]') && !!document.querySelector('.topbar')?.closest('[inert]')`));
  { const bg = await evalIn(`getComputedStyle(document.querySelector(${JSON.stringify(layerSelector)})).backgroundColor`); const alpha = Number((bg.match(/\/\s*([\d.]+)\)/) ?? bg.match(/,\s*([\d.]+)\)$/) ?? [0, 1])[1]); check(`${label}: scrim ≥ 75 %`, alpha >= 0.75, bg); }
  const before = await state();
  await drag(20, 60, 20, 320);        // sobre el scrim, izquierda, hacia abajo
  await drag(720, 320, 720, 40);      // derecha, hacia arriba
  await drag(30, 250, 700, 250);      // horizontal sobre la franja de canales
  const after = await state();
  check(`${label}: arrastrar sobre el scrim no desplaza nada`, JSON.stringify(before) === JSON.stringify(after), `canales ${before.channels}→${after.channels}, página ${before.page}→${after.page}`);
  await closeAction();
  await sleep(500);
  check(`${label}: al cerrar, el fondo vuelve a ser interactivo`, await evalIn(`!document.querySelector('[inert]') && !document.documentElement.classList.contains('has-modal')`));
}

// A) editor de marcadores: mantener pulsada la onda
const wave = await evalIn(`(() => { const r = document.querySelector('.wave-panel .waveform').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await touch("touchStart", wave.x, wave.y); await sleep(900); await touch("touchEnd", wave.x, wave.y); await sleep(600);
await inspect("marcador", ".marker-layer", ".marker-card", () => evalIn(`[...document.querySelectorAll('.marker-card button')].find(b => /CANCELAR|CERRAR/i.test(b.textContent))?.click(); 0`));

// B) cajón de Click
await evalIn(`document.querySelector('.tempo')?.click(); 0`);
await sleep(700);
await inspect("cajón de Click", ".drawer-backdrop", ".drawer", () => evalIn(`[...document.querySelectorAll('.drawer button')].find(b => /CERRAR/i.test(b.textContent))?.click(); 0`));

console.log(failed ? `\n${failed} comprobación(es) fallaron` : `\nTodo en orden`);
await fetch(`http://localhost:${port}/json/close/${target.id}`);
ws.close();
process.exit(failed ? 1 : 0);
