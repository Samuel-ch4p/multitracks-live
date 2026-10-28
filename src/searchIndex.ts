import { foldText } from "./driveSource.ts";

/**
 * Buscador de la Nube: normalización de texto, índice liviano (solo metadatos) y su persistencia en IndexedDB.
 * Nunca se guarda audio ni archivos: id, nombre, artista y tamaño de cada carpeta y zip.
 */
export type IndexArtist = { id: string; name: string };
export type IndexSong = { id: string; name: string; artistId: string; artist: string; size?: number };
export type IndexData = { version: 1; builtAt: number; rootId: string; artists: IndexArtist[]; songs: IndexSong[]; failed: number };

/** Minúsculas, sin acentos, guiones/puntos/guiones bajos como espacio y espacios colapsados. */
export function foldQuery(text: string): string {
  return foldText(text).replace(/[-_.–—/\\()[\]]+/g, " ").replace(/\s+/g, " ").trim();
}

export const queryTokens = (query: string) => foldQuery(query).split(" ").filter(Boolean);

/** Todas las palabras deben aparecer (en cualquier orden y como parte de una palabra). */
export const matchesAll = (haystack: string, tokens: string[]) => tokens.every((token) => haystack.includes(token));

export type SearchResult = { artists: IndexArtist[]; songs: IndexSong[]; totalArtists: number; totalSongs: number };

type Prepared = { artists: { item: IndexArtist; text: string }[]; songs: { item: IndexSong; text: string; title: string }[] };
const preparedCache = new WeakMap<IndexData, Prepared>();

function prepare(index: IndexData): Prepared {
  let prepared = preparedCache.get(index);
  if (!prepared) {
    prepared = {
      artists: index.artists.map((item) => ({ item, text: foldQuery(item.name) })),
      songs: index.songs.map((item) => ({ item, text: foldQuery(`${item.artist} ${item.name.replace(/\.zip$/i, "")}`), title: foldQuery(item.name.replace(/\.zip$/i, "")) })),
    };
    preparedCache.set(index, prepared);
  }
  return prepared;
}

/** Busca artistas y canciones. Las que empiezan por la búsqueda van primero; luego, por nombre. */
export function searchIndex(index: IndexData, query: string, limit = 60): SearchResult {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return { artists: [], songs: [], totalArtists: 0, totalSongs: 0 };
  const first = tokens[0];
  const prepared = prepare(index);
  const rank = (text: string) => (text.startsWith(first) ? 0 : text.includes(` ${first}`) ? 1 : 2);
  const artists = prepared.artists.filter((a) => matchesAll(a.text, tokens)).sort((a, b) => rank(a.text) - rank(b.text) || a.text.localeCompare(b.text));
  const songs = prepared.songs.filter((s) => matchesAll(s.text, tokens)).sort((a, b) => rank(a.title) - rank(b.title) || a.text.localeCompare(b.text));
  return { artists: artists.slice(0, limit).map((a) => a.item), songs: songs.slice(0, limit).map((s) => s.item), totalArtists: artists.length, totalSongs: songs.length };
}

/**
 * Construye el índice en segundo plano: una consulta por artista, con concurrencia limitada (por defecto 6).
 * Si falla alguna carpeta se omite y se cuenta en `failed`; si fallan todas, se propaga el error.
 */
export async function buildIndex(
  rootId: string,
  fetchArtists: () => Promise<IndexArtist[]>,
  fetchSongs: (artist: IndexArtist) => Promise<{ id: string; name: string; size?: number }[]>,
  options: { concurrency?: number; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {}
): Promise<IndexData> {
  const artists = await fetchArtists();
  const songs: IndexSong[] = [];
  let next = 0;
  let done = 0;
  let failed = 0;
  let lastError: unknown = null;
  options.onProgress?.(0, artists.length);

  const worker = async () => {
    while (next < artists.length && !options.signal?.aborted) {
      const artist = artists[next++];
      try {
        for (const song of await fetchSongs(artist)) songs.push({ id: song.id, name: song.name, artistId: artist.id, artist: artist.name, size: song.size });
      } catch (error) {
        failed++;
        lastError = error;
      }
      options.onProgress?.(++done, artists.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 6, artists.length)) }, worker));
  if (options.signal?.aborted) throw new DOMException("cancelado", "AbortError");
  if (artists.length > 0 && failed === artists.length) throw lastError ?? new Error("No se pudo construir el índice");
  return { version: 1, builtAt: Date.now(), rootId, artists, songs, failed };
}

// ---------- Persistencia en IndexedDB (si falla, la app sigue en memoria) ----------
const DB_NAME = "crescendo-meta";
const STORE = "kv";
const KEY = "nube-index-v1";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("sin IndexedDB")); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB falló"));
    request.onblocked = () => reject(new Error("IndexedDB bloqueada"));
  });
}

export async function loadIndex(rootId: string): Promise<IndexData | null> {
  try {
    const db = await openDb();
    try {
      const value = await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const data = value as IndexData | undefined;
      return data && data.version === 1 && data.rootId === rootId && Array.isArray(data.artists) && Array.isArray(data.songs) ? data : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function saveIndex(data: IndexData): Promise<boolean> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(data, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** "hace 3 días", "hoy"... para mostrar la fecha del índice sin ruido. */
export function ageLabel(builtAt: number, now = Date.now()): string {
  const days = Math.floor((now - builtAt) / 86_400_000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}
