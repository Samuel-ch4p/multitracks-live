import type { Layout } from "./panLaw.ts";

/** Análisis de nivel de cada pista (se hace una vez al cargar la canción) y cálculo de la ganancia de normalización. */

export type TrackKind = "click" | "guide" | "music";

export type TrackStats = {
  layout: Layout;
  /** Pico de muestra (0..1+) de la pista. */
  peak: number;
  /** Potencia media con compuerta (lineal). Es la potencia que sale por el centro del paneo. 0 = pista en silencio. */
  power: number;
};

// Objetivos (dBFS). Ver HANDOFF.md para la razón de cada uno.
export const TARGET_DB = -18; // instrumentos: potencia media de cada pista
export const GUIDE_DB = -20; // guía de voz: 2 dB por debajo de los instrumentos
export const CLICK_PEAK_DB = -6; // click: se iguala por pico (suena en ráfagas cortas)
export const MAX_UP_DB = 12;
export const MAX_DOWN_DB = -30;
export const PEAK_CEILING_DB = -1; // techo de pico por pista
export const MIX_POWER_DB = -14; // potencia estimada de toda la mezcla (faders a tope)
export const MIX_PEAK_DB = -1; // pico estimado de la mezcla
const PEAK_COINCIDENCE_DB = 3; // los picos de pistas distintas rara vez coinciden

const db = (x: number) => 20 * Math.log10(x);
const lin = (d: number) => Math.pow(10, d / 20);

/** Click y Guía se reconocen por el nombre de la pista (sin importar mayúsculas ni tildes). */
export function trackKind(name: string): TrackKind {
  const n = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/(^|[^a-z0-9])(click|clic|metronomo|metronome)s?(?![a-z0-9])/.test(n)) return "click";
  if (/(^|[^a-z0-9])(guia|guide|cue)s?(?![a-z0-9])/.test(n)) return "guide";
  return "music";
}

type PcmLike = { numberOfChannels: number; length: number; sampleRate: number; getChannelData(channel: number): Float32Array };

const rest = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Mide una pista ya decodificada. Recorre las muestras por bloques de ~1 millón y cede el hilo entre bloques,
 * así la pantalla no se congela. Devuelve null si se cancela.
 */
export async function measureBuffer(buffer: PcmLike, isCancelled: () => boolean = () => false): Promise<TrackStats | null> {
  const a = buffer.getChannelData(0);
  const stereo = buffer.numberOfChannels > 1;
  const b = stereo ? buffer.getChannelData(1) : a;
  const n = buffer.length;
  const blockLen = Math.max(1, Math.round(buffer.sampleRate * 0.4));
  const CHUNK = 1 << 20;

  let peak = 0;
  let eL = 0;
  let eR = 0;
  const blockL: number[] = [];
  const blockR: number[] = [];
  let bl = 0;
  let br = 0;
  let count = 0;

  for (let start = 0; start < n; start += CHUNK) {
    if (isCancelled()) return null;
    const end = Math.min(n, start + CHUNK);
    for (let i = start; i < end; i++) {
      const x = a[i];
      const y = b[i];
      const ax = x < 0 ? -x : x;
      const ay = y < 0 ? -y : y;
      if (ax > peak) peak = ax;
      if (ay > peak) peak = ay;
      const xx = x * x;
      const yy = y * y;
      eL += xx;
      eR += yy;
      bl += xx;
      br += yy;
      if (++count === blockLen) {
        blockL.push(bl / count);
        blockR.push(br / count);
        bl = br = 0;
        count = 0;
      }
    }
    if (end < n) await rest();
  }
  if (count > blockLen / 2) { blockL.push(bl / count); blockR.push(br / count); }

  // ¿Mono, un solo lado con sonido, o estéreo? (umbral -40 dB). Un estéreo con lo mismo en los dos lados se deja como estéreo:
  // así su volumen en el centro queda igual que antes y, al panear, la energía total tampoco cambia.
  let layout: Layout = "stereo";
  if (!stereo) layout = "mono";
  else if (eL + eR === 0) layout = "mono";
  else if (eR < eL * 1e-4) layout = "left";
  else if (eL < eR * 1e-4) layout = "right";

  // Potencia de salida por el centro del paneo (ver panLaw.ts): un canal si es mono-like, la suma si es estéreo.
  const power = blockL.map((l, i) => (layout === "stereo" ? l + blockR[i] : layout === "right" ? blockR[i] : l));
  const audible = power.filter((p) => p > 1e-5); // compuerta absoluta -50 dB
  let mean = audible.length ? audible.reduce((s, p) => s + p, 0) / audible.length : 0;
  if (mean > 0) {
    const kept = audible.filter((p) => p >= mean * 0.01); // compuerta relativa -20 dB
    mean = kept.reduce((s, p) => s + p, 0) / kept.length;
  }
  return { layout, peak, power: mean };
}

export type PlanItem = { kind: TrackKind; stats: TrackStats | null };

/**
 * Ganancia de normalización de cada pista (en el mismo orden que `items`).
 * 1) Cada pista se lleva a su objetivo (con tope de subida y techo de pico).
 * 2) Si la mezcla estimada pasa de MIX_POWER_DB o su pico estimado de MIX_PEAK_DB, TODAS bajan por igual.
 */
export function planGains(items: PlanItem[]): { gains: number[]; global: number } {
  const per = items.map(({ kind, stats }) => {
    if (!stats || stats.peak <= 0) return 1;
    let g: number;
    if (kind === "click") g = lin(CLICK_PEAK_DB) / stats.peak;
    else if (stats.power > 0) g = lin((kind === "guide" ? GUIDE_DB : TARGET_DB) - 10 * Math.log10(stats.power));
    else return 1;
    // En estéreo, al llevar el paneo a un extremo ese lado sube hasta +3 dB (ver panLaw.ts): se deja ese margen.
    const headroom = stats.layout === "stereo" ? Math.SQRT2 : 1;
    g = Math.min(g, lin(MAX_UP_DB), lin(PEAK_CEILING_DB) / (stats.peak * headroom));
    return Math.max(g, lin(MAX_DOWN_DB));
  });

  let sumPower = 0;
  let sumPeak = 0;
  items.forEach(({ stats }, i) => {
    if (!stats) return;
    sumPower += stats.power * per[i] * per[i];
    sumPeak += stats.peak * per[i] * (stats.peak * per[i]);
  });
  let reduction = 0;
  if (sumPower > 0) reduction = Math.min(reduction, MIX_POWER_DB - 10 * Math.log10(sumPower));
  if (sumPeak > 0) reduction = Math.min(reduction, MIX_PEAK_DB - (10 * Math.log10(sumPeak) - PEAK_COINCIDENCE_DB));
  const global = lin(reduction);
  return { gains: per.map((g) => g * global), global };
}

export { db as toDb };
