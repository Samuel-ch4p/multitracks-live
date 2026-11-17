// 1.1.1: el diagnóstico copiable incluye los datos de pantalla para reproducir problemas de diseño.
// Uso: node tools/verify-screen-info.ts
import { formatScreenInfo } from "../src/screenInfo.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

const rows = formatScreenInfo({
  inner: { width: 829, height: 360 }, visual: { width: 829, height: 360, scale: 1 }, dpr: 3.5, screen: { width: 3088, height: 1440 },
  orientation: "landscape-primary", safe: { top: 0, right: 48, bottom: 0, left: 0 }, fontScale: 1.3, heightFactor: 0.25,
});
const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
for (const [label, pattern] of [
  ["innerWidth/innerHeight", /innerWidth×innerHeight\): 829×360/],
  ["visualViewport (ancho, alto, escala)", /visualViewport\): 829×360 · escala 1/],
  ["devicePixelRatio", /devicePixelRatio\): ×3\.5/],
  ["screen.width/height", /screen\): 3088×1440/],
  ["orientación", /Orientación: landscape-primary/],
  ["márgenes seguros", /Márgenes seguros \(sup\/der\/inf\/izq\): 0\/48\/0\/0 px/],
  ["escala de letra", /Escala de letra detectada: ×1\.3/],
  ["factor de altura --t", /Factor de altura --t: 0\.25/],
] as const) check(`incluye ${label}`, pattern.test(text));
const none = formatScreenInfo({ inner: { width: 1280, height: 800 }, visual: null, dpr: 1, screen: { width: 1280, height: 800 }, orientation: "landscape", safe: { top: 0, right: 0, bottom: 0, left: 0 }, fontScale: null, heightFactor: null });
check("sin visualViewport ni --t: lo dice en vez de inventar", none.some(([, v]) => v === "No disponible") && none.some(([, v]) => /No aplica/.test(v)));

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
