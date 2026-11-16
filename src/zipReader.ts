/**
 * Lectura de ZIP por tramos: índice (directorio central) y cada pista por separado, sin cargar el ZIP entero en memoria.
 * Con DecompressionStream (navegadores y WebView actuales) se descomprime en nativo; sin él (WebView viejo, Android 6–8 sin
 * actualizar) se usa fflate en modo streaming, también por bloques. Sin dependencias del navegador más allá de Blob/streams:
 * se prueba en Node (tools/verify-zip-blocks.ts).
 */
import { Inflate } from "fflate";
import { decodeZipName } from "./zipNames.ts";

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

export const isHiddenPath = (path: string) => path.split("/").some((part) => part.startsWith(".") || part === "__MACOSX");

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---------- ZIP con el descompresor nativo del navegador ----------
// Se lee solo el índice del ZIP y cada pista se descomprime por tramos hacia un archivo del navegador:
// no se carga el ZIP entero en memoria (si viene de un archivo del dispositivo), no se bloquea la pantalla
// y las pistas guardadas sin compresión se usan sin copiarlas.

export type ZipEntry = { path: string; method: number; flags: number; compressed: number; size: number; offset: number };

/** Origen de bytes: un archivo/Blob (se lee por tramos) o un bloque ya en memoria (se leen vistas, sin copiar). */
export type ZipSource = {
  size: number;
  bytes: (start: number, end: number) => Promise<Uint8Array>;
  blob: (start: number, end: number, type?: string) => Blob;
  stream: (start: number, end: number) => ReadableStream<Uint8Array>;
};

export function sourceOf(data: Blob | Uint8Array): ZipSource {
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

export async function readZipIndex(source: ZipSource): Promise<ZipEntry[]> {
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
    // Nombre según el flag UTF-8 (bit 11); sin flag y sin ser UTF-8 válido: CP850/CP437 (Windows en español) y, de último, windows-1252.
    const path = decodeZipName(dir.subarray(at + 46, at + 46 + nameLength), flags);

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

export function hasNativeInflate(): boolean {
  try {
    if (typeof DecompressionStream === "undefined" || typeof Response === "undefined") return false;
    new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

/** Tamaño de los trozos de salida al descomprimir sin descompresor nativo. */
const OUT_CHUNK = 4 * 1024 * 1024;

/**
 * Descompresión DEFLATE por bloques con fflate (para WebView sin DecompressionStream). Lee la entrada por tramos y va guardando la
 * salida en trozos de 4 MB como partes de un Blob: en memoria solo hay un tramo de entrada y un trozo de salida a la vez.
 */
export async function inflateByBlocks(input: ReadableStream<Uint8Array>, type: string): Promise<Blob> {
  const parts: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  const flush = () => { if (pending.length) { parts.push(new Blob(pending as BlobPart[])); pending = []; pendingBytes = 0; } };
  const inflater = new Inflate((chunk) => {
    pending.push(chunk);
    pendingBytes += chunk.length;
    if (pendingBytes >= OUT_CHUNK) flush();
  });
  const reader = input.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) { inflater.push(new Uint8Array(0), true); break; }
    inflater.push(value, false);
    await breathe(); // la pantalla respira entre tramos
  }
  flush();
  return new Blob(parts, { type });
}

export async function extractEntry(source: ZipSource, entry: ZipEntry, name: string, native = true): Promise<File> {
  const type = audioType(name);
  const header = await source.bytes(entry.offset, entry.offset + 30);
  const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (headerView.getUint32(0, true) !== 0x04034b50) throw new Error("El ZIP está dañado o incompleto.");
  const start = entry.offset + 30 + headerView.getUint16(26, true) + headerView.getUint16(28, true);
  const end = start + entry.compressed;

  if (entry.method === 0) return new File([source.blob(start, end)], name, { type });
  if (entry.method !== 8) throw new Error("Este ZIP usa una compresión no compatible. Vuelve a comprimirlo como ZIP normal.");

  const inflated = native
    ? await new Response(
      source.stream(start, end).pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    ).blob()
    : await inflateByBlocks(source.stream(start, end), type);
  if (entry.size && inflated.size !== entry.size) throw new Error("El ZIP está dañado: una pista no se pudo descomprimir completa.");
  return new File([inflated], name, { type });
}

/**
 * Extrae las pistas de audio de un ZIP (archivo del dispositivo o bytes descargados). Ignora archivos ocultos y __MACOSX.
 */
export async function zipToFilesAsync(
  data: Blob | Uint8Array,
  onProgress?: (done: number, total: number) => void,
  options: { nativeInflate?: boolean } = {}
): Promise<File[]> {
  // Con o sin descompresor nativo se lee igual: índice y pista por pista, por tramos. Sin nativo (WebView viejo) se usa fflate en
  // modo streaming; ANTES se copiaba el ZIP entero a memoria (800 MB o más = cierre de la app en celulares de 3–4 GB).
  const native = options.nativeInflate ?? hasNativeInflate();
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
      files[index] = await extractEntry(source, entry, entry.path.split("/").pop() as string, native);
      onProgress?.(++done, wanted.length);
    }
  };
  // Sin descompresor nativo se extrae de una en una (fflate trabaja en el hilo principal: una a la vez reduce el pico de memoria).
  await Promise.all(native ? [worker(), worker()] : [worker()]);
  return files.filter((file): file is File => !!file);
}

