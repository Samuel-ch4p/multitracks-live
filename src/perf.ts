/**
 * Tiempos por etapa (performance.now) para diagnosticar cuánto tarda cada paso al cargar y al dar Play.
 * Se acumulan en `window.__perf` (arreglo de {fase, etapa, ms}); `window.__perfTable()` los imprime como tabla.
 * Cuesta casi nada; no cambia el comportamiento de la app.
 */
type Row = { phase: string; stage: string; ms: number };

const rows: Row[] = [];
const starts = new Map<string, number>();

declare global {
  interface Window {
    __perf?: Row[]; __perfTable?: () => void; __perfReset?: () => void;
    /** Solo en desarrollo: ganancia de normalización y fader reales de cada pista. */
    __demo?: (title?: string, count?: number, fakeMB?: number) => Promise<void>;
    __mix?: () => { name: string; norm: number; fader: number; pan: number[] }[];
  }
}

if (typeof window !== "undefined") {
  window.__perf = rows;
  window.__perfTable = () => console.table(rows.map((r) => ({ ...r, ms: Math.round(r.ms) })));
  window.__perfReset = () => { rows.length = 0; starts.clear(); };
}

/** Marca el inicio de una fase (p. ej. "play"). Las etapas se miden respecto de la marca anterior. */
export function perfBegin(phase: string) {
  starts.set(phase, performance.now());
  starts.set(`${phase}:last`, performance.now());
}

/** Registra cuánto pasó desde la marca anterior de esta fase. */
export function perfStep(phase: string, stage: string) {
  const now = performance.now();
  const last = starts.get(`${phase}:last`) ?? now;
  rows.push({ phase, stage, ms: now - last });
  starts.set(`${phase}:last`, now);
}

/** Registra el total de la fase desde perfBegin. */
export function perfEnd(phase: string, stage = "TOTAL") {
  const now = performance.now();
  rows.push({ phase, stage, ms: now - (starts.get(phase) ?? now) });
}

/** Mide una tarea suelta (decodificación de una pista, etc.). */
export async function perfTimed<T>(phase: string, stage: string, task: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try { return await task(); } finally { rows.push({ phase, stage, ms: performance.now() - t0 }); }
}
