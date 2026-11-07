/**
 * Fuente de canciones de la Nube Crescendo (reemplaza a la antigua fuente externa).
 * Agnóstico de plataforma: usa solo fetch/Blob (Android, navegador y Electron); el almacenamiento está en storage.ts.
 *
 * Descarga: UNA sola petición continua a /file (cada petición cuenta contra el límite diario del usuario), leída en streaming
 * y guardada en trozos de 4 MB como partes de un Blob (el navegador los administra fuera del montón de JS; no hay segunda copia).
 * Nada se reintenta solo, nada se guarda en el dispositivo: el Blob se descarta al terminar.
 */
import { audioExtensions, sortFiles, zipToFilesAsync } from "../archive";
import { apiGet } from "./api";
import { loadCatalog, type Catalog, type CatalogSong } from "./catalog";
import { CloudError } from "./errors";
import { readBodyToBlob } from "./stream.ts";

export { loadCatalog };
export type { Catalog, CatalogSong };

export type SongProgress =
  | { stage: "download"; received: number; total: number }
  | { stage: "extract"; done: number; total: number };

/** Si no llega ni un byte en este tiempo, se corta (red caída). */
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
  // Corte por inactividad, encadenado con la cancelación del usuario.
  const controller = new AbortController();
  const relay = () => controller.abort();
  signal.addEventListener("abort", relay);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stall = {
    arm: () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), STALL_MS); },
    clear: () => clearTimeout(timer),
  };
  try {
    stall.arm();
    // La clave se pide tal cual viene del catálogo (con espacios, acentos o "//"), codificada completa.
    const resp = await apiGet(`/file?key=${encodeURIComponent(song.key)}`, { signal: controller.signal });
    const blob = await readBodyToBlob(resp, song.size, (received, total) => onProgress({ stage: "download", received, total }), controller.signal, stall);
    if (signal.aborted) throw new CloudError("cancelled");

    const files = sortFiles(
      (await zipToFilesAsync(blob, (done, total) => onProgress({ stage: "extract", done, total }))).filter((file) => audioExtensions.test(file.name))
    );
    if (signal.aborted) throw new CloudError("cancelled");
    if (files.length === 0) throw new Error("No se encontraron pistas de audio compatibles en este archivo.");
    return files;
  } catch (e) {
    // Un corte por inactividad se ve igual que una cancelación para fetch: se distingue por quién lo pidió.
    if (controller.signal.aborted && !signal.aborted) throw new CloudError("network", 0, {}, "sin datos");
    throw e;
  } finally {
    stall.clear();
    signal.removeEventListener("abort", relay);
    inFlight = false;
  }
}
