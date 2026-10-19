import { unzipSync } from "fflate";
import { Archive } from "libarchive.js";

export const audioExtensions = /\.(wav|mp3|ogg|m4a|aac|flac|aiff|aif)$/i;

export function audioType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    aiff: "audio/aiff",
    aif: "audio/aiff",
  };
  return types[ext ?? ""] ?? "application/octet-stream";
}

export function sortFiles(files: File[]): File[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );
}

const isHiddenPath = (path: string) => path.split("/").some((part) => part.startsWith(".") || part === "__MACOSX");

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---------- ZIP con el descompresor nativo del navegador ----------
// Se lee solo el índice del ZIP y cada pista se descomprime por tramos hacia un archivo del navegador:
// no se carga el ZIP entero en memoria (si viene de un archivo del dispositivo), no se bloquea la pantalla
// y las pistas guardadas sin compresión se usan sin copiarlas.

type ZipEntry = { path: string; method: number; flags: number; compressed: number; size: number; offset: number };

/** Origen de bytes: un archivo/Blob (se lee por tramos) o un bloque ya en memoria (se leen vistas, sin copiar). */
type ZipSource = {
  size: number;
  bytes: (start: number, end: number) => Promise<Uint8Array>;
  blob: (start: number, end: number, type?: string) => Blob;
  stream: (start: number, end: number) => ReadableStream<Uint8Array>;
};

function sourceOf(data: Blob | Uint8Array): ZipSource {
  if (data instanceof Blob) {
    return {
      size: data.size,
      bytes: async (start, end) => new Uint8Array(await data.slice(start, end).arrayBuffer()),
      blob: (start, end, type) => data.slice(start, end, type),
      stream: (start, end) => data.slice(start, end).stream() as ReadableStream<Uint8Array>,
    };
  }
  return {
    size: data.length,
    bytes: async (start, end) => data.subarray(start, end),
    blob: (start, end, type) => new Blob([data.subarray(start, end) as BlobPart], { type }),
    stream: (start, end) => {
      let at = start;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (at >= end) { controller.close(); return; }
          controller.enqueue(data.subarray(at, Math.min(end, at + 1048576)));
          at += 1048576;
        },
      });
    },
  };
}

const num = (view: DataView, at: number) => Number(view.getBigUint64(at, true));

async function readZipIndex(source: ZipSource): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, source.size - 65557);
  const tail = await source.bytes(tailStart, source.size);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let at = tail.length - 22; at >= 0; at--) {
    if (tailView.getUint32(at, true) === 0x06054b50) { eocd = at; break; }
  }
  if (eocd < 0) throw new Error("El ZIP está dañado o incompleto.");

  let entries = tailView.getUint16(eocd + 10, true);
  let dirSize = tailView.getUint32(eocd + 12, true);
  let dirOffset = tailView.getUint32(eocd + 16, true);

  if (entries === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    // ZIP64 (archivos de más de 4 GB o con más de 65 535 elementos).
    if (eocd < 20 || tailView.getUint32(eocd - 20, true) !== 0x07064b50) throw new Error("El ZIP está dañado o incompleto.");
    const head = await source.bytes(num(tailView, eocd - 20 + 8), num(tailView, eocd - 20 + 8) + 56);
    const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (headView.getUint32(0, true) !== 0x06064b50) throw new Error("El ZIP está dañado o incompleto.");
    entries = num(headView, 32);
    dirSize = num(headView, 40);
    dirOffset = num(headView, 48);
  }

  const dir = await source.bytes(dirOffset, dirOffset + dirSize);
  const view = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const decoder = new TextDecoder();
  const list: ZipEntry[] = [];
  let at = 0;
  for (let index = 0; index < entries && at + 46 <= dir.length; index++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("El ZIP está dañado o incompleto.");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    let compressed = view.getUint32(at + 20, true);
    let size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let offset = view.getUint32(at + 42, true);
    const path = decoder.decode(dir.subarray(at + 46, at + 46 + nameLength));

    // Campo ZIP64 ampliado: trae, en orden, los valores que valían 0xFFFFFFFF.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let cursor = extra + 4;
        if (size === 0xffffffff) { size = num(view, cursor); cursor += 8; }
        if (compressed === 0xffffffff) { compressed = num(view, cursor); cursor += 8; }
        if (offset === 0xffffffff) { offset = num(view, cursor); }
      }
      extra += 4 + length;
    }

    list.push({ path, method, flags, compressed, size, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return list;
}

function hasNativeInflate(): boolean {
  try {
    if (typeof DecompressionStream === "undefined" || typeof Response === "undefined") return false;
    new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

async function extractEntry(source: ZipSource, entry: ZipEntry, name: string): Promise<File> {
  const type = audioType(name);
  const header = await source.bytes(entry.offset, entry.offset + 30);
  const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (headerView.getUint32(0, true) !== 0x04034b50) throw new Error("El ZIP está dañado o incompleto.");
  const start = entry.offset + 30 + headerView.getUint16(26, true) + headerView.getUint16(28, true);
  const end = start + entry.compressed;

  if (entry.method === 0) return new File([source.blob(start, end)], name, { type });
  if (entry.method !== 8) throw new Error("Este ZIP usa una compresión no compatible. Vuelve a comprimirlo como ZIP normal.");

  const inflated = await new Response(
    source.stream(start, end).pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
  ).blob();
  if (entry.size && inflated.size !== entry.size) throw new Error("El ZIP está dañado: una pista no se pudo descomprimir completa.");
  return new File([inflated], name, { type });
}

/**
 * Extrae las pistas de audio de un ZIP (archivo del dispositivo o bytes descargados). Ignora archivos ocultos y __MACOSX.
 */
export async function zipToFilesAsync(
  data: Blob | Uint8Array,
  onProgress?: (done: number, total: number) => void
): Promise<File[]> {
  if (!hasNativeInflate()) {
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    return zipToFilesFallback(bytes, onProgress);
  }

  const source = sourceOf(data);
  const wanted = (await readZipIndex(source)).filter((entry) => {
    const name = entry.path.split("/").pop() ?? "";
    return !entry.path.endsWith("/") && audioExtensions.test(name) && !isHiddenPath(entry.path);
  });
  if (wanted.some((entry) => entry.flags & 1)) throw new Error("Este ZIP está protegido con contraseña.");

  const files: (File | undefined)[] = new Array(wanted.length);
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const index = next++;
      const entry = wanted[index];
      files[index] = await extractEntry(source, entry, entry.path.split("/").pop() as string);
      onProgress?.(++done, wanted.length);
    }
  };
  await Promise.all([worker(), worker()]);
  return files.filter((file): file is File => !!file);
}

/**
 * Respaldo (si el navegador no trae descompresor nativo): extrae de una en una; en cada momento solo hay una pista descomprimida en memoria
 * (antes se abrían todas a la vez) y entre pista y pista la pantalla respira. Ignora archivos ocultos y __MACOSX.
 */
async function zipToFilesFallback(
  bytes: Uint8Array,
  onProgress?: (done: number, total: number) => void
): Promise<File[]> {
  const paths: string[] = [];
  unzipSync(bytes, {
    filter: (entry) => {
      if (audioExtensions.test(entry.name) && !isHiddenPath(entry.name)) paths.push(entry.name);
      return false; // solo se leen los nombres
    },
  });

  const files: File[] = [];
  for (let index = 0; index < paths.length; index++) {
    const path = paths[index];
    const name = path.split("/").pop();
    if (name) {
      const extracted = unzipSync(bytes, { filter: (entry) => entry.name === path });
      files.push(new File([extracted[path] as BlobPart], name, { type: audioType(name) }));
    }
    onProgress?.(index + 1, paths.length);
    await breathe();
  }
  return files;
}

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
    const listed = (await archive.getFilesArray()) as { file: { name: string; extract: () => Promise<File> }; path: string }[];
    const wanted = listed.filter(
      (entry) => audioExtensions.test(entry.file.name) && !isHiddenPath(entry.path) && !entry.file.name.startsWith(".")
    );

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

/**
 * Calcula la forma de onda combinada de varias pistas (picos normalizados 0..1).
 * Decodifica una pista a la vez para no saturar la memoria.
 */
export async function computePeaks(
  files: File[],
  buckets: number,
  isCancelled: () => boolean,
  onProgress?: (peaks: Float32Array) => void
): Promise<Float32Array | null> {
  const total = new Float32Array(buckets);
  let decodedAny = false;
  // Solo se dibuja un contorno: a 16 kHz cada pista ocupa unas 3 veces menos memoria al decodificarse.
  const decoder = new OfflineAudioContext(1, 1, 16000);

  for (const file of files) {
    if (isCancelled()) return null;
    if (file.size > 150 * 1024 * 1024) continue;
    try {
      const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
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
      for (let b = 0; b < buckets; b++) total[b] += trackPeaks[b];
      decodedAny = true;
      if (onProgress) onProgress(normalize(total));
    } catch {
      // Un formato que el navegador no decodifica no debe romper la forma de onda.
    }
  }
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
