import type { Catalog, CatalogArtist, CatalogSong } from "./cloud/catalog.ts";

/**
 * Buscador de la Nube: normalización de texto y búsqueda sobre el catálogo que ya está en memoria (solo metadatos).
 */

/** Minúsculas, sin acentos (para ordenar y buscar). */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Orden por nombre sin distinguir mayúsculas ni acentos (y con números en orden natural). */
export function sortByName<T>(items: T[], nameOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => foldText(nameOf(a)).localeCompare(foldText(nameOf(b)), "es", { numeric: true, sensitivity: "base" }));
}

/** Minúsculas, sin acentos, guiones/puntos/guiones bajos como espacio y espacios colapsados. */
export function foldQuery(text: string): string {
  return foldText(text).replace(/[-_.–—/\\()[\]]+/g, " ").replace(/\s+/g, " ").trim();
}

export const queryTokens = (query: string) => foldQuery(query).split(" ").filter(Boolean);

/** Todas las palabras deben aparecer (en cualquier orden y como parte de una palabra). */
export const matchesAll = (haystack: string, tokens: string[]) => tokens.every((token) => haystack.includes(token));

export type IndexSong = CatalogSong & { artist: string };
export type IndexData = { artists: CatalogArtist[]; songs: IndexSong[]; byArtist: Map<string, IndexSong[]> };
export type SearchResult = { artists: CatalogArtist[]; songs: IndexSong[]; totalArtists: number; totalSongs: number };

/** Prepara el catálogo: artistas ordenados, canciones ordenadas por artista y texto de búsqueda ya normalizado. */
export function buildIndex(catalog: Catalog): IndexData {
  const artists = sortByName(catalog.artists, (a) => a.name);
  const names = new Map(artists.map((a) => [a.id, a.name]));
  const songs: IndexSong[] = sortByName(catalog.songs, (s) => s.title).map((s) => ({ ...s, artist: names.get(s.artistId) ?? "" }));
  const byArtist = new Map<string, IndexSong[]>();
  for (const song of songs) {
    const list = byArtist.get(song.artistId);
    if (list) list.push(song); else byArtist.set(song.artistId, [song]);
  }
  return { artists, songs, byArtist };
}

type Prepared = { artists: { item: CatalogArtist; text: string }[]; songs: { item: IndexSong; text: string; title: string }[] };
const preparedCache = new WeakMap<IndexData, Prepared>();

function prepare(index: IndexData): Prepared {
  let prepared = preparedCache.get(index);
  if (!prepared) {
    prepared = {
      artists: index.artists.map((item) => ({ item, text: foldQuery([item.name, ...item.aliases].join(" ")) })),
      songs: index.songs.map((item) => ({ item, text: foldQuery(`${item.artist} ${item.title}`), title: foldQuery(item.title) })),
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
