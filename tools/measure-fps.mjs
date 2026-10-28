// Mide fotogramas por segundo del mezclador con una canción sonando, con la CPU ralentizada (por defecto 4x) en Chrome sin cabeza.
// Uso: node tools/measure-fps.mjs <url> [ralentizacion=4] [pistas=13]
// Requiere Chrome ya abierto con --remote-debugging-port=9333 (ver HANDOFF.md). No forma parte de `npm run verify`.
const [url, rateArg = "4", tracksArg = "13"] = process.argv.slice(2);
const rate = Number(rateArg);
const tracks = Number(tracksArg);
const port = 9333;

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
const evalIn = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails));
  return response.result?.result?.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 915, height: 412, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url });
await sleep(5000);

// Canciones sintéticas (WAV mono 22 kHz, 60 s) enviadas por el selector de archivos del panel "Este dispositivo".
await evalIn(`(async () => {
  const names = ["Bateria","Bajo","Teclas","Guitarra","Coros","Voz","Pad","Cuerdas","Percusion","Piano","Sinte","Click","Guia","Loop","FX","Coro 2","Organo","Brass"];
  const wav = (seconds, freq, rate = 22050) => {
    const n = Math.floor(seconds * rate); const buffer = new ArrayBuffer(44 + n * 2); const v = new DataView(buffer);
    const text = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    text(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); text(8, "WAVE"); text(12, "fmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * freq * i / rate) * (0.35 + 0.3 * Math.sin(i / rate * 1.7 + freq)) * 12000, true);
    return new Blob([buffer], { type: "audio/wav" });
  };
  const opener = document.querySelector(".deck-empty, .deck-add");
  opener.click();
  await new Promise((r) => setTimeout(r, 600));
  const input = document.querySelector('input[type="file"]');
  const transfer = new DataTransfer();
  names.slice(0, ${tracks}).forEach((name, i) => transfer.items.add(new File([wav(60, 110 * (1 + i * 0.37))], "Prueba - " + name + ".wav", { type: "audio/wav" })));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
})()`);
// Espera a que las pistas estén listas
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  const ready = await evalIn(`!!document.querySelector(".play-btn") && !document.querySelector(".play-btn").disabled && !document.querySelector(".prepare-bar") && document.querySelectorAll(".channel").length > 1`);
  if (ready) break;
}
await evalIn(`document.querySelector(".library-close")?.click()`);
await sleep(800);
await send("Emulation.setCPUThrottlingRate", { rate });
await evalIn(`document.querySelector(".top-tools ~ *, .play-btn") && document.querySelector(".topbar .play-btn").click()`);
await sleep(3000);

const measure = (label) => evalIn(`new Promise((resolve) => {
  const deltas = []; let last = performance.now(); const start = last;
  const tick = (now) => { deltas.push(now - last); last = now; if (now - start < 8000) requestAnimationFrame(tick); else {
    const sorted = [...deltas].sort((a, b) => a - b);
    resolve({ label: ${JSON.stringify(label)}, frames: deltas.length, fps: +(deltas.length / ((now - start) / 1000)).toFixed(1), p50ms: +sorted[Math.floor(sorted.length * 0.5)].toFixed(1), p95ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), slowPct: +(100 * deltas.filter((d) => d > 33.4).length / deltas.length).toFixed(1) });
  } };
  requestAnimationFrame(tick);
})`);

const results = [];
results.push(await measure("En vivo (mezclador)"));
await evalIn(`document.querySelector(".tab-bar button:nth-child(3)").click()`);
await sleep(800);
results.push(await measure("Mezcla"));
console.log(JSON.stringify({ url, cpuSlowdown: rate, tracks, playing: await evalIn(`!!document.querySelector(".play-btn.is-playing")`), results }, null, 2));
await fetch(`http://localhost:${port}/json/close/${target.id}`);
process.exit(0);
