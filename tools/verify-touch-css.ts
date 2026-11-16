// P9: las zonas táctiles de 44 px están definidas y su hoja de estilos se carga la última (manda sobre las ampliaciones viejas de −4 px).
// La medición real se hace en el navegador con tools/touch-targets-audit.js.
// Uso: node tools/verify-touch-css.ts
import { readFileSync } from "node:fs";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf-8");

const css = read("src/styles/touch.css");
const app = read("src/App.tsx");
const styleImports = [...app.matchAll(/import "\.\/styles\/([\w-]+)\.css"/g)].map((m) => m[1]);

check("touch.css se importa en App.tsx", styleImports.includes("touch"));
check("…y es la última hoja de estilos de App.tsx", styleImports[styleImports.length - 1] === "touch", styleImports.join(", "));
check("mínimo de 44 px", /--hit:\s*44px/.test(css));
check("cada lado crece solo lo que falta (sin pisar vecinos)", css.includes("min(0px, calc((100% - var(--hit)) / 2))"));
for (const selector of [".icon-btn::after", ".glass-btn::after", ".tempo::after", ".chip::after", ".play-btn::before", ".deck-remove", ".setlist-actions button", ".source-switch button::before", ".song-deck .deck-card", ".pan-readout::after"]) {
  check(`zona táctil definida: ${selector}`, css.includes(selector));
}
check("letra grande: NORM pasa a dos líneas en vez de salirse", /\.chip\.norm\s*\{[^}]*flex-wrap:\s*wrap/.test(css));
check("excepciones documentadas", /Excepciones medidas/.test(css));

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
