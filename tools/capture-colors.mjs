// Captura la app en modo ?demo (solo desarrollo) a varios tamaños, guarda PNG sin pérdida y calcula puntos de muestreo de color.
// Uso: node tools/capture-colors.mjs <carpeta_salida> [url=http://localhost:5173/?demo&nosplash]
// Requiere Edge/Chrome con --remote-debugging-port=9333 (ver HANDOFF.md). Luego tools/sample-colors.ps1 lee los píxeles.
import fs from "fs";

const out = process.argv[2];
const url = process.argv[3] ?? "http://localhost:5173/?demo&nosplash";
const port = 9333;
fs.mkdirSync(out, { recursive: true });
const sizes = [[915, 412, "h915"], [800, 360, "h800"], [412, 915, "v412"], [1280, 800, "pc1280"]];

const target = await (await fetch(`http://localhost:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (event) => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
const evalIn = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const points = {};
await send("Page.enable");
for (const [w, h, name] of sizes) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900 });
  await send("Page.navigate", { url });
  await sleep(6500);
  // Puntos de muestreo (centro de cada elemento, o un punto concreto)
  points[name] = await evalIn(`(() => {
    // Punto cuyo elemento más alto es el propio elemento (no un hijo): ahí el píxel es la superficie real del elemento
    const own = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect();
      const x0 = Math.max(0, Math.floor(b.left)), x1 = Math.min(innerWidth - 1, Math.ceil(b.right)), y0 = Math.max(0, Math.floor(b.top)), y1 = Math.min(innerHeight - 1, Math.ceil(b.bottom));
      for (let y = y0 + 3; y < y1 - 3; y += 3) for (let x = x0 + 3; x < x1 - 3; x += 3) {
        if (document.elementFromPoint(x, y) !== e) continue;
        if ([[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]].every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy) === e)) return [x, y]; }
      return null; };
    return {
      "fondo de la app": own(".app"),
      "barra superior": own(".topbar"),
      "panel (caja de canales)": own(".channels-box"),
      "canal (relleno)": own(".channel:not(.master)"),
      "tarjeta setlist inactiva": own(".deck-card:not(.active)"),
      "tarjeta setlist activa": own(".deck-card.active"),
      "panel de la onda": own(".wave-panel"),
      "barra de pestañas": own(".tab-bar"),
      "columna MASTER": own(".channel.master"),
    };
  })()`);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${out}/${name}.png`, Buffer.from(shot.result.data, "base64"));
}
fs.writeFileSync(`${out}/points.json`, JSON.stringify(points, null, 2));
await fetch(`http://localhost:${port}/json/close/${target.id}`);
console.log("listo", Object.keys(points).join(", "));
process.exit(0);
