import { Archive } from "libarchive.js";
import { measureBuffer, type TrackStats } from "./analysis.ts";
import { analyzeWav } from "./wavAnalysis.ts";
import { perfTimed } from "./perf.ts";
import { audioExtensions, audioType, isHiddenPath, zipToFilesAsync } from "./zipReader.ts";

export { audioExtensions, audioType, zipToFilesAsync };

export function sortFiles(files: File[]): File[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );
}

const RAR_MAX_BYTES = 900 * 1024 * 1024;

let archiveInitialized = false;

function initializeArchive() {
  if (archiveInitialized) return;

  Archive.init({
    workerUrl: `${import.meta.env.BASE_URL}worker-bundle.js`,
  });

  archiveInitialized = true;
}

/**
 * Extrae las pistas de audio de un RAR (en el navegador, sin servidor), una por una y cerrando al terminar.
 * Antes se extraía todo de golpe y el lector quedaba abierto con el archivo entero en memoria.
 */
export async function rarToFiles(
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<File[]> {
  initializeArchive();
  const archive = await Archive.open(file);
  try {
    if ((await archive.hasEncryptedData()) === true) {
      throw new Error("Este archivo RAR está protegido con contraseña.");
    }
    const listed = (await archive.getFilesArray()) as { file: { name: string; size: number; extract: () => Promise<File> }; path: string }[];
    const wanted = listed.filter(
      (entry) => audioExtensions.test(entry.file.name) && !isHiddenPath(entry.path) && !entry.file.name.startsWith(".")
    );

    // Un RAR se extrae a memoria (WASM) y cada pista queda como Blob: pasado cierto tamaño el navegador del celular
    // se queda sin espacio (las últimas pistas salen ilegibles o la app se cierra). Mejor avisar antes que colgarse.
    const totalBytes = wanted.reduce((sum, entry) => sum + (entry.file.size || 0), 0);
    if (totalBytes > RAR_MAX_BYTES) {
      throw new Error(
        `Este RAR ocupa ${(totalBytes / 1e9).toFixed(1)} GB ya descomprimido y el celular no puede abrirlo. ` +
        "Conviértelo en la PC a ZIP sin compresión (solo las pistas de audio) y vuelve a elegirlo: el ZIP no se carga en memoria."
      );
    }

    const files: File[] = [];
    for (let index = 0; index < wanted.length; index++) {
      const extracted = await wanted[index].file.extract();
      files.push(new File([extracted], extracted.name, { type: audioType(extracted.name) }));
      onProgress?.(index + 1, wanted.length);
    }
    return files;
  } finally {
    await archive.close(); // libera el trabajador y la copia del archivo
  }
}

/** Convierte lo que el usuario eligió (audios sueltos, ZIP o RAR) en canciones. */
export async function songsFromPicked(
  picked: File[],
  onStatus: (message: string) => void
): Promise<{ name: string; files: File[] }[]> {
  const songs: { name: string; files: File[] }[] = [];

  for (const file of picked) {
    const isZip = /\.zip$/i.test(file.name);
    const isRar = /\.rar$/i.test(file.name);
    if (!isZip && !isRar) continue;
    onStatus(`Extrayendo ${file.name}…`);
    const progress = (done: number, total: number) => onStatus(`Extrayendo ${file.name} · pista ${done} de ${total}…`);
    const files = isZip
      ? await zipToFilesAsync(file, progress)
      : await rarToFiles(file, progress);
    const audio = sortFiles(files.filter((item) => audioExtensions.test(item.name)));
    if (audio.length === 0) throw new Error(`${file.name} no contiene pistas de audio compatibles.`);
    songs.push({ name: file.name.replace(/\.(zip|rar)$/i, ""), files: audio });
  }

  const loose = sortFiles(
    picked
      .filter((file) => audioExtensions.test(file.name))
      .map((file) => (file.type ? file : new File([file], file.name, { type: audioType(file.name) })))
  );
  if (loose.length) songs.push({ name: commonName(loose), files: loose });
  return songs;
}

/** Nombre de canción a partir del prefijo común de las pistas (p. ej. "Jubilo - Bajo", "Jubilo - GA" → "Jubilo"). */
function commonName(files: File[]): string {
  const names = files.map((file) => file.name.replace(/\.[^/.]+$/, ""));
  if (names.length === 1) return names[0];
  let prefix = names[0];
  for (const name of names.slice(1)) {
    while (prefix && !name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  const cleaned = prefix.replace(/[\s_\-–.]+$/, "").trim();
  return cleaned.length >= 3 ? cleaned : "Canción local";
}

export type PeaksOptions = {
  isCancelled: () => boolean;
  /** Mientras devuelva true (suena la canción) el análisis espera: el audio tiene prioridad sobre el procesador y la memoria. */
  shouldWait?: () => boolean;
  onProgress?: (peaks: Float32Array) => void;
  onStats?: (file: File, stats: TrackStats) => void;
  /** Se llama una vez por pista al terminar de procesarla (con éxito, con error o saltada): sirve para contar el avance. */
  onSettled?: (file: File) => void;
  /** Pistas que se miden (nivel/tipo) pero NO suman a la forma de onda (Click y Guía). */
  excludeFromPeaks?: (file: File) => boolean;
  /** Pistas procesadas a la vez (decodificar es lo que más memoria usa: 2 es lo prudente en un celular). */
  concurrency?: number;
};

/**
 * Calcula la forma de onda combinada de varias pistas (picos normalizados 0..1) y, en la misma pasada,
 * mide el nivel de cada pista (`onStats`, para normalizar volúmenes y detectar mono/estéreo).
 * Procesa hasta `concurrency` pistas a la vez (por defecto 2) para no saturar la memoria.
 */
export async function computePeaks(files: File[], buckets: number, options: PeaksOptions): Promise<Float32Array | null> {
  const { isCancelled, shouldWait, onProgress, onStats, onSettled, excludeFromPeaks } = options;
  const total = new Float32Array(buckets);
  let decodedAny = false;
  let cancelled = false;
  // A 22,05 kHz cada pista ocupa la mitad de memoria que a 44,1 kHz y el nivel (RMS) se mide igual de bien;
  // el pico de muestra puede quedar algo por debajo del real en sonidos muy agudos (hay margen: techo de -1 dBFS).
  const decoder = new OfflineAudioContext(1, 1, 22050);
  let next = 0;

  const addPeaks = (file: File, peaks: Float32Array) => {
    if (!excludeFromPeaks?.(file)) {
      for (let b = 0; b < buckets; b++) total[b] += peaks[b];
      decodedAny = true;
      if (onProgress) onProgress(normalize(total));
    }
  };

  const processFile = async (file: File) => {
    // WAV: se lee directo por tandas (sin decodificar, sin límite de tamaño, casi sin memoria).
    if (/\.wav$/i.test(file.name)) {
      const direct = await analyzeWav(file, buckets, isCancelled);
      if (direct === "cancelled") { cancelled = true; return; }
      if (direct) {
        onStats?.(file, direct.stats);
        addPeaks(file, direct.peaks);
        return;
      }
    }
    if (file.size > 150 * 1024 * 1024) return; // el resto de formatos se decodifica entero: se salta lo muy grande
    const decoded = await perfTimed("carga", "decodificar pista (" + file.name + ")", async () => decoder.decodeAudioData(await file.arrayBuffer()));
    if (onStats) {
      const stats = await perfTimed("carga", "analizar nivel (" + file.name + ")", () => measureBuffer(decoded, isCancelled));
      if (!stats) { cancelled = true; return; }
      onStats(file, stats);
    }
    const trackPeaks = new Float32Array(buckets);
    const per = decoded.length / buckets;
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let b = 0; b < buckets; b++) {
        const start = Math.floor(b * per);
        const end = Math.min(data.length, Math.floor((b + 1) * per));
        const step = Math.max(1, Math.floor((end - start) / 64));
        let max = 0;
        for (let i = start; i < end; i += step) {
          const v = Math.abs(data[i]);
          if (v > max) max = v;
        }
        if (max > trackPeaks[b]) trackPeaks[b] = max;
      }
    }
    addPeaks(file, trackPeaks);
  };

  const worker = async () => {
    while (next < files.length && !cancelled) {
      const file = files[next++];
      while (shouldWait?.() && !isCancelled()) await new Promise((resolve) => setTimeout(resolve, 400));
      if (isCancelled()) { cancelled = true; return; }
      try {
        await processFile(file);
      } catch (error) {
        // Un formato que el navegador no decodifica no debe romper la forma de onda.
        console.warn("No se pudo analizar la pista", file.name, error);
      }
      if (!cancelled) onSettled?.(file);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 2, files.length)) }, worker));
  if (cancelled || isCancelled()) return null;
  return decodedAny ? normalize(total) : null;
}

function normalize(values: Float32Array): Float32Array {
  let max = 0;
  for (const v of values) if (v > max) max = v;
  const out = new Float32Array(values.length);
  if (max <= 0) return out;
  for (let i = 0; i < values.length; i++) out[i] = Math.pow(values[i] / max, 0.8);
  return out;
}
