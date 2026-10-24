import { StatsAccumulator, type TrackStats } from "./analysis.ts";

/**
 * Análisis directo de WAV sin decodificar: lee el archivo por tandas de 4 MB, mide nivel (mismo cálculo que
 * `measureBuffer`) y saca los picos por tramo para la forma de onda. Casi no usa memoria, así que no hay límite de
 * tamaño (antes los WAV de más de 150 MB se saltaban y la canción se quedaba sin forma de onda ni normalización),
 * y es mucho más rápido que decodificar cada pista completa.
 * Formatos: PCM 8/16/24/32 bits y float 32/64 bits, cualquier nº de canales (se usan los dos primeros).
 * Si el archivo no es un WAV de esos, devuelve null y se usa el camino normal (decodificar).
 */

type WavInfo = { float: boolean; channels: number; rate: number; bits: number; dataStart: number; dataLength: number };

function parseWavHeader(bytes: Uint8Array, fileSize: number): WavInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (bytes.length < 12 || (tag(0) !== "RIFF" && tag(0) !== "RF64") || tag(8) !== "WAVE") return null;
  let format = 0;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && body + 16 <= bytes.length) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26 && body + 26 <= bytes.length) format = view.getUint16(body + 24, true); // extensible
    } else if (id === "data") {
      if (!format || !channels || !rate) return null;
      const float = format === 3;
      if (format !== 1 && !float) return null;
      if (float ? bits !== 32 && bits !== 64 : ![8, 16, 24, 32].includes(bits)) return null;
      const available = fileSize - body;
      const length = size === 0 || size === 0xffffffff || size > available ? available : size; // RF64 / cabecera sin cerrar
      return { float, channels, rate, bits, dataStart: body, dataLength: length };
    }
    at = body + size + (size & 1);
  }
  return null;
}

/** Convierte una tanda de bytes en dos canales Float32 (L y R; en mono, el mismo arreglo). */
function deinterleave(info: WavInfo, view: DataView, frames: number, left: Float32Array, right: Float32Array) {
  const { channels, bits, float } = info;
  const step = bits / 8;
  const frameBytes = step * channels;
  const read = (at: number): number => {
    if (float) return bits === 32 ? view.getFloat32(at, true) : view.getFloat64(at, true);
    switch (bits) {
      case 8: return (view.getUint8(at) - 128) / 128;
      case 16: return view.getInt16(at, true) / 32768;
      case 24: return ((view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16))) / 8388608;
      default: return view.getInt32(at, true) / 2147483648;
    }
  };
  for (let i = 0; i < frames; i++) {
    const at = i * frameBytes;
    left[i] = read(at);
    right[i] = channels > 1 ? read(at + step) : left[i];
  }
}

const TANDA = 4 * 1024 * 1024;

export async function analyzeWav(
  file: Blob,
  buckets: number,
  isCancelled: () => boolean
): Promise<{ peaks: Float32Array; stats: TrackStats } | null | "cancelled"> {
  const info = parseWavHeader(new Uint8Array(await file.slice(0, 65536).arrayBuffer()), file.size);
  if (!info) return null;
  const frameBytes = (info.bits / 8) * info.channels;
  const totalFrames = Math.floor(info.dataLength / frameBytes);
  if (totalFrames <= 0) return null;

  const framesPerTanda = Math.max(1, Math.floor(TANDA / frameBytes));
  const left = new Float32Array(framesPerTanda);
  const right = info.channels > 1 ? new Float32Array(framesPerTanda) : left;
  const acc = new StatsAccumulator(info.rate, info.channels > 1);
  const peaks = new Float32Array(buckets);
  const perBucket = totalFrames / buckets;

  for (let frame = 0; frame < totalFrames; frame += framesPerTanda) {
    if (isCancelled()) return "cancelled";
    const frames = Math.min(framesPerTanda, totalFrames - frame);
    const from = info.dataStart + frame * frameBytes;
    const buffer = await file.slice(from, from + frames * frameBytes).arrayBuffer();
    const got = Math.min(frames, Math.floor(buffer.byteLength / frameBytes));
    if (got <= 0) break;
    deinterleave(info, new DataView(buffer), got, left, right);
    acc.push(left, right, 0, got);
    let bucket = Math.min(buckets - 1, Math.floor(frame / perBucket));
    let limit = (bucket + 1) * perBucket;
    let max = peaks[bucket];
    for (let i = 0; i < got; i++) {
      if (frame + i >= limit && bucket < buckets - 1) {
        peaks[bucket] = max;
        bucket++;
        limit = (bucket + 1) * perBucket;
        max = peaks[bucket];
      }
      const l = left[i] < 0 ? -left[i] : left[i];
      const r = right[i] < 0 ? -right[i] : right[i];
      const m = l > r ? l : r;
      if (m > max) max = m;
    }
    peaks[bucket] = max;
  }
  return { peaks, stats: acc.finish() };
}
