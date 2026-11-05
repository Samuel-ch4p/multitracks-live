/**
 * Fuente de canciones de la Nube Crescendo (reemplaza a la antigua fuente externa).
 * Agnóstico de plataforma: el almacenamiento (storage.ts) y la descarga a archivo temporal están detrás de pequeñas interfaces.
 */
import { CloudError } from "./errors";
import { loadCatalog, type Catalog, type CatalogSong } from "./catalog";

export { loadCatalog };
export type { Catalog, CatalogSong };

export type SongProgress =
  | { stage: "download"; received: number; total: number }
  | { stage: "extract"; done: number; total: number };

/** Descarga la canción y devuelve sus pistas. (La descarga real se implementa en la fase 3.) */
export async function fetchSongFiles(_song: CatalogSong, _onProgress: (p: SongProgress) => void, _signal: AbortSignal): Promise<File[]> {
  throw new CloudError("other", 0, {}, "descarga aún no disponible");
}
