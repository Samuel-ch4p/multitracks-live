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

/** Extrae solo las pistas de audio de un ZIP, ignorando archivos ocultos y __MACOSX. */
export function zipToFiles(bytes: Uint8Array): File[] {
  const files: File[] = [];
  const contents = unzipSync(bytes);
  for (const [archivePath, data] of Object.entries(contents)) {
    if (!audioExtensions.test(archivePath)) continue;
    const parts = archivePath.split("/");
    if (parts.some((part) => part.startsWith(".") || part === "__MACOSX")) continue;
    const name = parts[parts.length - 1];
    if (!name) continue;
    files.push(new File([data.slice()], name, { type: audioType(name) }));
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

function isBlobLike(value: unknown): value is Blob {
  if (!value || typeof value !== "object") return false;

  const candidate = value as {
    size?: unknown;
    arrayBuffer?: unknown;
    slice?: unknown;
  };

  return (
    typeof candidate.size === "number" &&
    typeof candidate.arrayBuffer === "function" &&
    typeof candidate.slice === "function"
  );
}

function collectArchiveFiles(
  value: unknown,
  result: File[] = [],
  nameHint = "",
  visited = new Set<object>()
): File[] {
  if (value === null || value === undefined) {
    return result;
  }

  if (typeof value !== "object") {
    return result;
  }

  if (visited.has(value)) {
    return result;
  }

  visited.add(value);

  if (isBlobLike(value)) {
    const candidate = value as Blob & { name?: string };
    const name =
      typeof candidate.name === "string"
        ? candidate.name
        : nameHint.split("/").pop() || "";

    if (name && audioExtensions.test(name)) {
      result.push(
        new File([candidate], name, {
          type: audioType(name),
        })
      );
    }

    return result;
  }

  if (value instanceof ArrayBuffer) {
    const name = nameHint.split("/").pop() || "";

    if (name && audioExtensions.test(name)) {
      result.push(
        new File([value], name, {
          type: audioType(name),
        })
      );
    }

    return result;
  }

  if (ArrayBuffer.isView(value)) {
    const name = nameHint.split("/").pop() || "";

    if (name && audioExtensions.test(name)) {
      const bytes = new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength
      );

      result.push(
        new File([bytes.slice()], name, {
          type: audioType(name),
        })
      );
    }

    return result;
  }

  if (Array.isArray(value)) {
    for (const child of value) {
      collectArchiveFiles(child, result, nameHint, visited);
    }

    return result;
  }

  const objectValue = value as Record<string, unknown>;

  for (const [key, child] of Object.entries(objectValue)) {
    const childHint =
      key.includes(".") || key.includes("/")
        ? key
        : nameHint || key;

    collectArchiveFiles(child, result, childHint, visited);
  }

  return result;
}


/** Extrae las pistas de audio de un archivo RAR (en el navegador, sin servidor). */
export async function rarToFiles(file: File): Promise<File[]> {
  initializeArchive();
  const archive = await Archive.open(file);
  if ((await archive.hasEncryptedData()) === true) {
    throw new Error("Este archivo RAR está protegido con contraseña.");
  }
  const extracted = await archive.extractFiles();
  return collectArchiveFiles(extracted);
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
    const files = isZip
      ? zipToFiles(new Uint8Array(await file.arrayBuffer()))
      : await rarToFiles(file);
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
  const decoder = new OfflineAudioContext(1, 1, 44100);

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
