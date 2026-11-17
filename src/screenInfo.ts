/**
 * Datos de pantalla para el diagnóstico copiable (Ajustes → 7 toques en la versión → Diagnóstico → Copiar diagnóstico).
 * Sirve para reproducir problemas de diseño en un celular concreto (alto útil, escala de letra del sistema, factor --t de fit.css).
 * readScreenData mide en el navegador; formatScreenInfo es pura (se prueba en tools/verify-screen-info.ts).
 */
export type ScreenData = {
  inner: { width: number; height: number };
  visual: { width: number; height: number; scale: number } | null;
  dpr: number;
  screen: { width: number; height: number };
  orientation: string;
  safe: { top: number; right: number; bottom: number; left: number };
  /** Escala de letra del sistema detectada (Android: textZoom del WebView). 1 = normal. */
  fontScale: number | null;
  /** Factor de altura de fit.css en px (0 con 320 dp útiles … 1 con 480 dp); null si no aplica (fuera del celular en horizontal bajo). */
  heightFactor: number | null;
};

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

export function formatScreenInfo(d: ScreenData): [string, string][] {
  return [
    ["Pantalla (innerWidth×innerHeight)", `${d.inner.width}×${d.inner.height}`],
    ["Área visible (visualViewport)", d.visual ? `${round(d.visual.width, 1)}×${round(d.visual.height, 1)} · escala ${round(d.visual.scale)}` : "No disponible"],
    ["Densidad (devicePixelRatio)", `×${round(d.dpr)}`],
    ["Pantalla física (screen)", `${d.screen.width}×${d.screen.height}`],
    ["Orientación", d.orientation],
    ["Márgenes seguros (sup/der/inf/izq)", `${round(d.safe.top, 1)}/${round(d.safe.right, 1)}/${round(d.safe.bottom, 1)}/${round(d.safe.left, 1)} px`],
    ["Escala de letra detectada", d.fontScale == null ? "No disponible" : `×${round(d.fontScale)}`],
    ["Factor de altura --t", d.heightFactor == null ? "No aplica (no es celular en horizontal de ≤ 520 px)" : `${round(d.heightFactor, 3)} (0 = 320 dp, 1 = 480 dp o más)`],
  ];
}

/** Mide en el navegador. Usa elementos de prueba invisibles que se quitan en el acto. */
export function readScreenData(): ScreenData {
  const probe = (style: Partial<CSSStyleDeclaration>, parent: Element = document.body) => {
    const el = document.createElement("div");
    Object.assign(el.style, { position: "absolute", visibility: "hidden", pointerEvents: "none", left: "0", top: "0" }, style);
    parent.appendChild(el);
    return el;
  };
  let safe = { top: 0, right: 0, bottom: 0, left: 0 };
  try {
    const el = probe({ paddingTop: "env(safe-area-inset-top)", paddingRight: "env(safe-area-inset-right)", paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)" });
    const cs = getComputedStyle(el);
    safe = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    el.remove();
  } catch { /* sin DOM */ }
  let fontScale: number | null = null;
  try {
    // El WebView de Android aplica la letra del sistema al tamaño calculado: 100 px pedidos → 100 × escala.
    const el = probe({ fontSize: "100px" });
    el.textContent = "M";
    fontScale = parseFloat(getComputedStyle(el).fontSize) / 100 || null;
    el.remove();
  } catch { /* sin DOM */ }
  let heightFactor: number | null = null;
  try {
    const app = document.querySelector(".app");
    if (app && getComputedStyle(app).getPropertyValue("--t").trim()) {
      const el = probe({ width: "calc(var(--t) * 1000)" }, app);
      heightFactor = el.getBoundingClientRect().width / 1000;
      el.remove();
    }
  } catch { /* sin DOM */ }
  const vv = window.visualViewport;
  const orientation = screen.orientation?.type ?? (window.matchMedia?.("(orientation: landscape)").matches ? "landscape" : "portrait");
  return {
    inner: { width: window.innerWidth, height: window.innerHeight },
    visual: vv ? { width: vv.width, height: vv.height, scale: vv.scale } : null,
    dpr: window.devicePixelRatio,
    screen: { width: screen.width, height: screen.height },
    orientation,
    safe,
    fontScale,
    heightFactor,
  };
}
