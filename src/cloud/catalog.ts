import { apiGet } from "./api";
import { cloudStorage } from "./storage";

export type SongFormat = "zip" | "rar" | "7z";

export type CatalogArtist = { id: string; name: string; aliases: string[] };
export type CatalogSong = {
  id: string;
  artistId: string;
  title: string;
  /** Ruta en el almacenamiento (empieza por "library/"). Se usa tal cual, sin normalizar ni recortar. */
  key: string;
  size: number;
  format: SongFormat;
  bpm: number | null;
  tone: string | null;
  modTime: string | null;
};
export type Catalog = { version: number | string; generatedAt: string; artists: CatalogArtist[]; songs: CatalogSong[] };

/** Solo los ZIP se pueden abrir por ahora. RAR y 7z se muestran como "próximamente" y no se descargan. */
export const isPlayable = (song: Pick<CatalogSong, "format">) => song.format === "zip";

// El catálogo es solo texto (nombres, tamaños, etiquetas): se guarda para no repetir la descarga. Nunca se guarda audio.
const CACHE_KEY = "crescendo.catalog.v1";
type Cached = { etag: string | null; catalog: Catalog };

function normalize(raw: unknown): Catalog {
  const data = (raw ?? {}) as Partial<Catalog>;
  const artists = (Array.isArray(data.artists) ? data.artists : []).map((a) => ({ id: String(a.id), name: String(a.name ?? ""), aliases: Array.isArray(a.aliases) ? a.aliases.map(String) : [] }));
  const songs = (Array.isArray(data.songs) ? data.songs : []).map((s) => ({
    id: String(s.id),
    artistId: String(s.artistId),
    title: String(s.title ?? ""),
    key: String(s.key ?? ""),
    size: Number(s.size) || 0,
    format: (["zip", "rar", "7z"].includes(String(s.format).toLowerCase()) ? String(s.format).toLowerCase() : "zip") as SongFormat,
    bpm: typeof s.bpm === "number" ? s.bpm : null,
    tone: typeof s.tone === "string" && s.tone ? s.tone : null,
    modTime: typeof s.modTime === "string" ? s.modTime : null,
  }));
  return { version: data.version ?? 0, generatedAt: String(data.generatedAt ?? ""), artists, songs };
}

async function readCache(): Promise<Cached | null> {
  try {
    const text = await cloudStorage().get(CACHE_KEY);
    if (!text) return null;
    const parsed = JSON.parse(text) as Cached;
    return parsed && parsed.catalog && Array.isArray(parsed.catalog.songs) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Catálogo con ETag: si no cambió, el servidor responde 304 y se usa la copia guardada.
 * Sin conexión devuelve la copia guardada (`offline: true`) para poder seguir mirando la lista.
 */
export async function loadCatalog(): Promise<{ catalog: Catalog; offline: boolean }> {
  const cached = await readCache();
  try {
    const resp = await apiGet("/catalog", cached?.etag ? { headers: { "If-None-Match": cached.etag } } : {});
    if (resp.status === 304 && cached) return { catalog: cached.catalog, offline: false };
    const catalog = normalize(await resp.json());
    try { await cloudStorage().set(CACHE_KEY, JSON.stringify({ etag: resp.headers.get("ETag"), catalog } satisfies Cached)); } catch { /* sigue sin copia */ }
    return { catalog, offline: false };
  } catch (e) {
    if (cached && (e as { kind?: string }).kind === "network") return { catalog: cached.catalog, offline: true };
    throw e;
  }
}
