// Prueba el cuadro de búsqueda de la Biblioteca tecleando de verdad (CDP) mientras la lista se refiltra:
//  · carácter a carácter (30-50 ms entre teclas) "cerca de mi", "hillsong" y "él me amó"
//  · con composición de teclado (Input.imeSetComposition + Input.insertText), como un teclado móvil
// Comprueba en cada paso que input.value coincide con lo tecleado, que el cursor avanza y que el campo es siempre el mismo elemento.
// Uso: node tools/verify-search-typing.mjs [url=http://localhost:5173/?demo&catalog=demo] [puerto=9334]
// Requiere `npm run dev` y Chrome/Edge con --remote-debugging-port=<puerto>. No forma parte de `npm run verify`.
const [url = "http://localhost:5173/?demo&catalog=demo", portArg = "9334"] = process.argv.slice(2);
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
await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url });
await sleep(6000);
await evalIn(`[...document.querySelectorAll('.tab-bar button')].find((b) => /Biblioteca/.test(b.textContent)).click(); 0`);
await sleep(600);
await evalIn(`[...document.querySelectorAll('.source-switch button')].find((b) => /Nube/.test(b.textContent)).click(); 0`);
await sleep(1500);

let failed = 0;
const results = [];
const check = (name, ok, detail = "") => { if (!ok) failed++; results.push(ok); console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? ` · ${detail}` : ""}`); };

const count = await evalIn(`document.querySelector('.lib-count')?.textContent ?? 'sin catálogo'`);
console.log(`Catálogo: ${count}`);
await evalIn(`window.__inp = document.querySelector('.lib-search input'); window.__inp.focus(); 0`);
const state = () => evalIn(`(() => { const i = document.querySelector('.lib-search input'); return { value: i.value, caret: i.selectionStart, same: i === window.__inp, focused: document.activeElement === i, results: (document.querySelector('.lib-results')?.innerText ?? '').slice(0, 60) }; })()`);
const clear = async () => { await evalIn(`(() => { const i = window.__inp; i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.focus(); return 0; })()`); await sleep(400); };

/** Carácter a carácter con teclas reales. */
async function typeSlow(text, label) {
  await clear();
  let typed = "";
  let okValue = true, okCaret = true, okSame = true, okFocus = true;
  let bad = "";
  for (const ch of text) {
    typed += ch;
    await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, unmodifiedText: ch, key: ch, ...(ch === " " ? { code: "Space" } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    await sleep(30 + Math.floor(Math.random() * 21));
    const s = await state();
    if (s.value !== typed) { okValue = false; bad ||= `esperado «${typed}», hay «${s.value}»`; }
    if (s.caret !== typed.length) { okCaret = false; bad ||= `cursor ${s.caret} ≠ ${typed.length}`; }
    if (!s.same) okSame = false;
    if (!s.focused) okFocus = false;
  }
  await sleep(500);
  const end = await state();
  check(`«${text}» (${label}): input.value coincide en cada paso`, okValue && end.value === text, bad);
  check(`«${text}» (${label}): el cursor avanza con cada letra`, okCaret);
  check(`«${text}» (${label}): el campo es siempre el mismo elemento y conserva el foco`, okSame && okFocus);
  check(`«${text}» (${label}): la lista se filtra al terminar`, end.results.length > 0, end.results.replace(/\n/g, " | "));
}

/** Como un teclado móvil: texto en composición (subrayado) que crece y se confirma. */
async function typeComposing(text, label) {
  await clear();
  let okValue = true, okFrozen = true, bad = "";
  const before = (await state()).results;
  for (let i = 1; i <= text.length; i++) {
    const partial = text.slice(0, i);
    await send("Input.imeSetComposition", { text: partial, selectionStart: partial.length, selectionEnd: partial.length });
    await sleep(40);
    const s = await state();
    if (s.value !== partial) { okValue = false; bad ||= `esperado «${partial}», hay «${s.value}»`; }
    await sleep(200); // más que la pausa de filtrado: aun así NO debe filtrar durante la composición
    if ((await state()).results !== before) okFrozen = false;
  }
  await send("Input.insertText", { text });
  await sleep(120);
  const end = await state();
  check(`«${text}» (${label}): input.value coincide durante la composición`, okValue, bad);
  check(`«${text}» (${label}): no filtra mientras se compone`, okFrozen);
  check(`«${text}» (${label}): al confirmar queda «${text}» con el cursor al final y filtra`, end.value === text && end.caret === text.length && end.same && end.results !== before, end.results.replace(/\n/g, " | "));
}

await typeSlow("cerca de mi", "tecla a tecla");
await typeSlow("hillsong", "tecla a tecla");
await typeSlow("él me amó", "tecla a tecla");
await typeComposing("cerca de mi", "composición");
await typeComposing("hillsong", "composición");
await typeComposing("él me amó", "composición");

// Modo búsqueda: al enfocar se ocultan cabecera y barras; al salir (blur) todo vuelve
await clear();
const searching = await evalIn(`document.querySelector('.app').dataset.searching === 'true' && getComputedStyle(document.querySelector('.tab-bar')).display === 'none'`);
check("con el campo enfocado: modo búsqueda activo (barra de pestañas oculta)", searching);
await evalIn(`window.__inp.blur(); 0`);
await sleep(600);
const normal = await evalIn(`document.querySelector('.app').dataset.searching !== 'true' && getComputedStyle(document.querySelector('.tab-bar')).display !== 'none'`);
check("al salir (blur): todo vuelve a su estado normal", normal);

await send("Target.closeTarget", { targetId: target.id });
ws.close();
console.log(failed ? `\n${failed} comprobación(es) con FALLA de ${results.length}` : `\nTodo en orden (${results.length} comprobaciones)`);
process.exit(failed ? 1 : 0);
