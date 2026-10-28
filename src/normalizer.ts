import type { TrackStats } from "./analysis.ts";
import {
  LEVEL_MIN_TRACK_DB, LEVEL_OUTLIER_DB, MAX_GAIN_DB, MIN_GAIN_DB, PEAK_CEILING_DB, PEAK_COINCIDENCE_DB,
  LIMITER_KNEE_DB, LIMITER_OVERSHOOT_DB, REFERENCE_DB, SILENCE_ABS_POWER, SILENCE_REL_DB, type NormMode,
} from "./normConfig.ts";

/** Planificador de la normalización (función pura: sin audio, se prueba con tools/verify-normalize.ts). */

export type PlanTrack = {
  /** Click o Guía: fuera de todo (ganancia exactamente 1, no se mide para nivel). */
  excluded: boolean;
  stats: TrackStats | null;
};

export type NormPlan = {
  /** Ganancia lineal por pista (mismo orden que la entrada). Las excluidas valen exactamente 1. */
  gains: number[];
  /** Ganancia única de la canción en dB (la que se aplica a las pistas musicales), 0 si no se pudo calcular. */
  songGainDb: number;
  /** Nivel medido de la mezcla musical en dB (o null si falta información). */
  mixDb: number | null;
  /** Por qué no se aplicó nada, si es el caso. */
  reason?: "off" | "incomplete" | "no-music";
};

const lin = (db: number) => Math.pow(10, db / 20);
const db = (x: number) => 20 * Math.log10(x);
const clampDb = (value: number) => Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, value));

/** Potencia media con compuerta de una serie de ventanas (misma regla que al medir cada pista). */
export function gatedMeanPower(blocks: ArrayLike<number>): number {
  const audible: number[] = [];
  for (let i = 0; i < blocks.length; i++) if (blocks[i] > SILENCE_ABS_POWER) audible.push(blocks[i]);
  let mean = audible.length ? audible.reduce((sum, p) => sum + p, 0) / audible.length : 0;
  if (mean > 0) {
    const floor = mean * Math.pow(10, SILENCE_REL_DB / 10);
    const kept = audible.filter((p) => p >= floor);
    mean = kept.reduce((sum, p) => sum + p, 0) / kept.length;
  }
  return mean;
}

/** Nivel (dBFS RMS por canal) de la mezcla de las pistas dadas: se suman las potencias ventana a ventana y se aplican las compuertas. */
export function mixLevelDb(tracks: TrackStats[], gainsDb: number[] = []): number | null {
  const length = Math.max(0, ...tracks.map((t) => t.blocks.length));
  if (length === 0) return null;
  const mix = new Float64Array(length);
  tracks.forEach((t, i) => {
    const g = lin(gainsDb[i] ?? 0) ** 2;
    for (let b = 0; b < t.blocks.length; b++) mix[b] += t.blocks[b] * g;
  });
  const power = gatedMeanPower(mix);
  // Las ventanas suman la energía de los dos canales de salida; el nivel de referencia es por canal (RMS dBFS): mitad de energía.
  return power > 0 ? 10 * Math.log10(power / 2) : null;
}

/** Mediana de una lista. */
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Calcula la ganancia de cada pista.
 *  - "off": todo 1.
 *  - "soft": UNA ganancia para todas las pistas musicales (referencia - nivel de la mezcla), limitada a ±6 dB y a lo que permita el techo de pico.
 *  - "level": igual que "soft" pero antes se corrigen (±6 dB) solo las pistas musicales cuyo nivel se desvíe más de LEVEL_OUTLIER_DB de la mediana.
 * Si falta la medición de alguna pista musical, no se aplica nada (ganancia 1): nunca se normaliza con datos a medias.
 */
export function planNormalization(tracks: PlanTrack[], mode: NormMode): NormPlan {
  const ones = tracks.map(() => 1);
  if (mode === "off") return { gains: ones, songGainDb: 0, mixDb: null, reason: "off" };

  const music = tracks.map((t, i) => ({ t, i })).filter(({ t }) => !t.excluded);
  if (music.length === 0) return { gains: ones, songGainDb: 0, mixDb: null, reason: "no-music" };
  if (music.some(({ t }) => !t.stats)) return { gains: ones, songGainDb: 0, mixDb: null, reason: "incomplete" };

  const stats = music.map(({ t }) => t.stats as TrackStats);
  // Corrección por pista (solo "level").
  const corrections = stats.map(() => 0);
  if (mode === "level") {
    const levels = stats.map((s) => (s.power > 0 ? 10 * Math.log10(s.power) : -Infinity));
    const audible = levels.filter((l) => l > LEVEL_MIN_TRACK_DB);
    if (audible.length >= 3) {
      const mid = median(audible);
      levels.forEach((l, k) => {
        if (l <= LEVEL_MIN_TRACK_DB) return; // ruido o silencio: no se sube
        const dev = l - mid;
        if (Math.abs(dev) > LEVEL_OUTLIER_DB) corrections[k] = clampDb(-(dev - Math.sign(dev) * LEVEL_OUTLIER_DB));
      });
    }
  }

  const mixDb = mixLevelDb(stats, corrections);
  if (mixDb === null) return { gains: ones, songGainDb: 0, mixDb: null, reason: "no-music" };

  let songDb = clampDb(REFERENCE_DB - mixDb);
  // Techo de pico: pico estimado de la mezcla (suma en potencia de los picos + margen) con las ganancias aplicadas.
  const peakSum = stats.reduce((sum, s, k) => sum + (s.peak * lin(corrections[k])) ** 2, 0);
  if (peakSum > 0) {
    const estimated = db(Math.sqrt(peakSum)) + PEAK_COINCIDENCE_DB;
    songDb = Math.min(songDb, PEAK_CEILING_DB - estimated);
  }
  songDb = Math.max(MIN_GAIN_DB, songDb); // el techo nunca baja más de lo permitido: el limitador se encarga del resto

  const gains = [...ones];
  music.forEach(({ i }, k) => { gains[i] = lin(clampDb(songDb + corrections[k])); }); // cada pista, ±6 dB en total
  return { gains, songGainDb: songDb, mixDb };
}

/** Curva del limitador suave de la mezcla musical: identidad hasta LIMITER_KNEE_DB y tanh hasta PEAK_CEILING_DB (nunca lo supera). */
export function limiterCurve(points = 4097): Float32Array<ArrayBuffer> {
  const knee = lin(LIMITER_KNEE_DB);
  const ceiling = lin(PEAK_CEILING_DB - LIMITER_OVERSHOOT_DB);
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a <= knee ? x : Math.sign(x) * (knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee)));
  }
  return curve;
}
