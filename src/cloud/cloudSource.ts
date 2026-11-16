/**
 * Fuente de canciones de la Nube Crescendo (reemplaza a la antigua fuente externa).
 * Agnóstico de plataforma: usa solo fetch/Blob (Android, navegador y Electron); el almacenamiento está en storage.ts.
 *
 * Descarga: una petición continua a /file, leída en streaming y guardada en trozos de 4 MB como partes de un Blob (el navegador los
 * administra fuera del montón de JS; no hay segunda copia). Si la conexión se corta, se REANUDA con Range desde lo recibido
 * (resumable.ts); el límite del servidor cuenta canciones distintas, así que reanudar no gasta cupo. Nada se guarda en el dispositivo.
 */
import { audioExtensions, sortFiles, zipToFilesAsync } from "../archive";
import { apiGet } from "./api";
import { loadCatalog, type Catalog, type CatalogSong } from "./catalog";
import { CloudError } from "./errors";
import { downloadResumable } from "./resumable.ts";

export { loadCatalog };
export type { Catalog, CatalogSong };

export type SongProgress =
  | { stage: "download"; received: number; total: number }
  | { stage: "extract"; done: number; total: number };

/** Si no llega ni un byte en este tiempo, se corta la conexión y se reanuda (red colgada). */
const STALL_MS = 30000;

let inFlight = false;
/** Hay una descarga en curso (solo se permite una a la vez). */
export const isDownloading = () => inFlight;

/** Descarga la canción (ZIP) y devuelve sus pistas de audio, listas para `onSongLoaded(..., { inMemory: true })`. */
export async function fetchSongFiles(song: CatalogSong, onProgress: (p: SongProgress) => void, signal: AbortSignal): Promise<File[]> {
  // Solo en desarrollo: llaves «dev://…» usan una nube falsa (ver devCloud.ts); en el APK este bloque no existe.
  if (import.meta.env.DEV && song.key.startsWith("dev://")) {
    if (inFlight) throw new CloudError("other", 0, {}, "ya hay una descarga");
    inFlight = true;
    try { return await (await import("../devCloud")).devFetchSongFiles(song, onProgress, signal); } finally { inFlight = false; }
  }
  if (song.format !== "zip") throw new CloudError("other", 0, {}, "formato no disponible");
  if (inFlight) throw new CloudError("other", 0, {}, "ya hay una descarga");
  inFlight = true;
  try {
    // La clave se pide tal cual viene del catálogo (con espacios, acentos o "//"), codificada completa.
    const path = `/file?key=${encodeURIComponent(song.key)}`;
    const blob = await downloadResumable(
      (offset, attemptSignal) => apiGet(path, { signal: attemptSignal, headers: offset > 0 ? { Range: `bytes=${offset}-` } : {} }),
      { expectedSize: song.size, onProgress: (received, total) => onProgress({ stage: "download", received, total }), signal, stallMs: STALL_MS },
    );
    if (signal.aborted) throw new CloudError("cancelled");

    const files = sortFiles(
      (await zipToFilesAsync(blob, (done, total) => onProgress({ stage: "extract", done, total }))).filter((file) => audioExtensions.test(file.name))
    );
    if (signal.aborted) throw new CloudError("cancelled");
    if (files.length === 0) throw new Error("No se encontraron pistas de audio compatibles en este archivo.");
    return files;
  } finally {
    inFlight = false;
  }
}
