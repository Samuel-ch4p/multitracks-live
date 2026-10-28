import type { Layout } from "./panLaw.ts";
import { BLOCK_SECONDS, SILENCE_ABS_POWER, SILENCE_REL_DB } from "./normConfig.ts";

/** Medición de cada pista (una vez al cargar la canción). El plan de normalización vive en normalizer.ts. */

export type TrackStats = {
  layout: Layout;
  /** Pico de muestra (0..1+) de la pista. */
  peak: number;
  /** Potencia media con compuerta (lineal). Es la potencia que sale por el centro del paneo. 0 = pista en silencio. */
  power: number;
  /** Potencia por ventana de BLOCK_SECONDS (la misma cuadrícula de tiempo en todas las pistas), para medir la mezcla. */
  blocks: Float32Array;
};

const db = (x: number) => 20 * Math.log10(x);

type PcmLike = { numberOfChannels: number; length: number; sampleRate: number; getChannelData(channel: number): Float32Array };

const rest = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Acumulador de nivel por bloques: recibe las muestras por tandas (L y R; en mono, el mismo arreglo en las dos)
 * y al final entrega las estadísticas. Lo usan `measureBuffer` (pista decodificada) y el lector directo de WAV
 * (wavAnalysis.ts), así los dos miden exactamente igual.
 */
export class StatsAccumulator {
  private blockLen: number;
  private stereo: boolean;
  private peak = 0;
  private eL = 0;
  private eR = 0;
  private blockL: number[] = [];
  private blockR: number[] = [];
  private bl = 0;
  private br = 0;
  private count = 0;

  constructor(sampleRate: number, stereo: boolean) {
    this.blockLen = Math.max(1, Math.round(sampleRate * BLOCK_SECONDS));
    this.stereo = stereo;
  }

  push(a: ArrayLike<number>, b: ArrayLike<number>, start: number, end: number) {
    let { peak, eL, eR, bl, br, count } = this;
    const blockLen = this.blockLen;
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
        this.blockL.push(bl / count);
        this.blockR.push(br / count);
        bl = br = 0;
        count = 0;
      }
    }
    this.peak = peak; this.eL = eL; this.eR = eR; this.bl = bl; this.br = br; this.count = count;
  }

  finish(): TrackStats {
    const { blockL, blockR, stereo, eL, eR } = this;
    if (this.count > this.blockLen / 2) { blockL.push(this.bl / this.count); blockR.push(this.br / this.count); }

    // ¿Mono, un solo lado con sonido, o estéreo? (umbral -40 dB). Un estéreo con lo mismo en los dos lados se deja como estéreo:
    // así su volumen en el centro queda igual que antes y, al panear, la energía total tampoco cambia.
    let layout: Layout = "stereo";
    if (!stereo) layout = "mono";
    else if (eL + eR === 0) layout = "mono";
    else if (eR < eL * 1e-4) layout = "left";
    else if (eL < eR * 1e-4) layout = "right";

    // Potencia de salida por el centro del paneo (ver panLaw.ts): un canal si es mono-like, la suma si es estéreo.
    const power = blockL.map((l, i) => (layout === "stereo" ? l + blockR[i] : layout === "right" ? blockR[i] : l));
    const audible = power.filter((p) => p > SILENCE_ABS_POWER); // compuerta absoluta -50 dB
    let mean = audible.length ? audible.reduce((s, p) => s + p, 0) / audible.length : 0;
    if (mean > 0) {
      const kept = audible.filter((p) => p >= mean * Math.pow(10, SILENCE_REL_DB / 10)); // compuerta relativa
      mean = kept.reduce((s, p) => s + p, 0) / kept.length;
    }
    return { layout, peak: this.peak, power: mean, blocks: Float32Array.from(power) };
  }
}

/**
 * Mide una pista ya decodificada. Recorre las muestras por bloques de ~1 millón y cede el hilo entre bloques,
 * así la pantalla no se congela. Devuelve null si se cancela.
 */
export async function measureBuffer(buffer: PcmLike, isCancelled: () => boolean = () => false): Promise<TrackStats | null> {
  const a = buffer.getChannelData(0);
  const stereo = buffer.numberOfChannels > 1;
  const b = stereo ? buffer.getChannelData(1) : a;
  const n = buffer.length;
  const CHUNK = 1 << 20;
  const acc = new StatsAccumulator(buffer.sampleRate, stereo);
  for (let start = 0; start < n; start += CHUNK) {
    if (isCancelled()) return null;
    const end = Math.min(n, start + CHUNK);
    acc.push(a, b, start, end);
    if (end < n) await rest();
  }
  return acc.finish();
}

export { db as toDb };
