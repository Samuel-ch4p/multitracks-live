// 1.1.1 · Diseño en pantallas bajas: en CADA tamaño de la matriz, la fila de canciones debe verse dentro de la pantalla y poder tocarse,
// y ningún canal ni MASTER puede quedar tapado por la barra inferior. FALLA (exit 1) si no.
// Arranca su propio servidor de Vite y un Chrome/Edge sin ventana (protocolo de depuración). Forma parte de `npm run verify`.
// Uso: node tools/verify-layout.mjs        (CHROME_PATH=... para indicar el navegador)
// Alturas = alto ÚTIL (ya sin barra de estado ni navegación de tres botones), como lo recibe el WebView de la app.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";

const HEIGHTS = [320, 340, 360, 390, 411, 430];
const WIDTHS = [640, 760, 900];
const FONT_SCALES = [1, 1.15, 1.3];

let failed = 0;
const issues = [];
const fail = (msg) => { failed++; issues.push(msg); };

const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const browserPath = candidates.find((p) => existsSync(p));
if (!browserPath) {
  console.log("FALLA no se encontró Chrome ni Edge para la prueba de diseño (define CHROME_PATH)");
  process.exit(1);
}

const server = await createServer({ logLevel: "silent", server: { port: 0, strictPort: false } });
await server.listen();
const port = server.httpServer.address().port;
const profile = mkdtempSync(join(tmpdir(), "crescendo-layout-"));
const debugPort = 9400 + Math.floor(Math.random() * 400);
const browser = spawn(browserPath, [
  "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "--disable-gpu", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "about:blank",
], { stdio: "ignore" });

async function cleanup() {
  try { browser.kill(); } catch { /* ya cerrado */ }
  await server.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* el navegador puede tardar en soltar la carpeta */ }
}

try {
  let target = null;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* aún arrancando */ }
    if (!target) await new Promise((r) => setTimeout(r, 200));
  }
  if (!target) throw new Error("el navegador no respondió");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? "error en la página");
    return response.result?.result?.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 800, height: 360, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://localhost:${port}/?demo` });
  // Espera a que el modo demo monte las canciones y añade dos de la nube falsa (como en las capturas de Samuel)
  for (let i = 0; i < 60; i++) { if (await evaluate("document.querySelectorAll('.deck-card').length >= 3 && typeof window.__demoCloud === 'function'")) break; await sleep(250); }
  await evaluate("window.__demoCloud(2, 120)");
  await sleep(6000); // los avisos («Canción 2 añadida…») se ocultan solos a los 5 s; no son parte del diseño

  // Escala de letra del sistema: Android multiplica el tamaño de TODA la letra del WebView. Se simula multiplicando el tamaño calculado
  // de cada elemento (se guarda el tamaño base la primera vez para no acumular).
  const applyScale = (scale) => evaluate(`(() => {
    for (const el of document.querySelectorAll('.app *')) {
      if (!el.dataset.fsBase) { el.style.fontSize = ''; el.dataset.fsBase = getComputedStyle(el).fontSize; }
      el.style.fontSize = ${scale} === 1 ? '' : (parseFloat(el.dataset.fsBase) * ${scale}) + 'px';
    }
    return true;
  })()`);

  const measure = () => evaluate(`(() => {
    const out = [];
    const r = (el) => el.getBoundingClientRect();
    const bar = document.querySelector('.tab-bar');
    const deck = document.querySelector('.song-deck');
    if (!bar) return ['sin barra inferior'];
    const barTop = r(bar).top;
    if (r(bar).bottom > innerHeight + 0.5) out.push('la barra inferior se sale de la pantalla');
    if (!deck || getComputedStyle(deck).display === 'none') return [...out, 'la fila de canciones está OCULTA'];
    const d = r(deck);
    if (d.height < 24) out.push('fila de canciones demasiado baja (' + Math.round(d.height) + ' px)');
    if (d.top < 0 || d.bottom > barTop + 0.5) out.push('la fila de canciones no está dentro de la pantalla');
    const card = deck.querySelector('.deck-card .deck-main');
    if (card) {
      const c = r(card);
      const hit = document.elementFromPoint(c.left + Math.min(c.width / 2, 40), c.top + c.height / 2);
      if (!hit || !card.contains(hit) && hit !== card) out.push('la primera canción no se puede tocar (tapada)');
    } else out.push('sin tarjetas de canción');
    const wave = document.querySelector('.wave-panel');
    if (!wave || r(wave).height < 30 || r(wave).bottom > barTop + 0.5) out.push('la onda no se ve completa');
    const channels = [...document.querySelectorAll('.channel')];
    if (!channels.some((ch) => ch.classList.contains('master'))) out.push('no hay MASTER');
    for (const ch of channels) {
      const c = r(ch);
      const name = ch.querySelector('.channel-name');
      const label = (name?.textContent || 'canal').trim().slice(0, 14);
      if (c.bottom > barTop + 0.5) out.push(label + ': el canal queda bajo la barra inferior (' + Math.round(c.bottom - barTop) + ' px)');
      if (name && r(name).bottom > barTop + 0.5) out.push(label + ': el nombre queda bajo la barra inferior');
      if (c.top < 0) out.push(label + ': el canal sale por arriba');
      const fader = ch.querySelector('.fader-rail');
      if (fader && r(fader).height < 24) out.push(label + ': fader demasiado corto (' + Math.round(r(fader).height) + ' px)');
    }
    return out;
  })()`);

  let checked = 0;
  for (const width of WIDTHS) {
    for (const height of HEIGHTS) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      for (const scale of FONT_SCALES) {
        await applyScale(scale);
        await sleep(120);
        const found = await measure();
        checked++;
        const tag = `${width}×${height} letra ×${scale}`;
        if (found.length) for (const msg of found) fail(`${tag}: ${msg}`);
        else console.log(`OK   ${tag}: fila de canciones visible y nada bajo la barra inferior`);
      }
      await applyScale(1);
    }
  }
  ws.close();
  console.log(`\n${checked} tamaños comprobados`);
} catch (error) {
  fail(`la prueba no pudo ejecutarse: ${error instanceof Error ? error.message : error}`);
} finally {
  await cleanup();
}

for (const msg of issues) console.log(`FALLA ${msg}`);
console.log(failed ? `\n${failed} FALLA(S)` : "Todo en orden");
process.exit(failed ? 1 : 0);
