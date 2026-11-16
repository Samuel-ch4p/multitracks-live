import { loadCatalog, type CatalogSong } from "./cloud/cloudSource";
import { CloudError, friendlyCloudMessage } from "./cloud/errors";
import { isPlayable } from "./cloud/catalog";
import type { SavedSong, SongConfig } from "./setlistStore";

export type QueueResult = { title: string; ok: boolean; reason?: string };

type Deps = {
  /** Pone la canción en el setlist como referencia (sin descargarla: la ventana de memoria decide cuándo cargarla). */
  addRef: (item: { id: string; key: string; title: string; size: number; tone: string | null; bpm: number | null }, options: { config?: SongConfig; master?: number }) => boolean;
  /** Pone una canción de «Este dispositivo» como «Elige el archivo» (con su mezcla), sin catálogo ni red. */
  addLocal?: (saved: SavedSong, options: { master?: number }) => boolean;
  onStart: (index: number, total: number, title: string) => void;
  signal: AbortSignal;
  /** Volumen master guardado con el culto; se aplica al activar la primera canción. */
  master?: number;
};

const reasonOf = (e: unknown): string => {
  if (e instanceof CloudError) return friendlyCloudMessage(e);
  if (e instanceof Error && !/fetch|network|abort/i.test(e.message)) return e.message;
  return friendlyCloudMessage(e);
};

/**
 * Arma el setlist de un culto guardado con REFERENCIAS (cualquier número, sin descargar nada aquí). Las de «Este dispositivo» entran como
 * «Elige el archivo» con su mezcla (ver localSongs.ts) aunque no haya red.
 * La primera queda activa y se descarga de inmediato; la app mantiene cargadas las primeras de la ventana (activa, anterior y siguientes
 * que quepan en el presupuesto) y deja el resto «En cola». Las que ya no están en la biblioteca o aún no se pueden abrir se informan.
 * Se corta del todo solo si no se pudo consultar la biblioteca o si el usuario cancela.
 */
export async function runSetlistQueue(refs: SavedSong[], deps: Deps): Promise<{ results: QueueResult[]; cancelled: boolean; stopReason?: string }> {
  const results: QueueResult[] = [];
  let byId = new Map<string, CatalogSong>();
  let byKey = new Map<string, CatalogSong>();
  let catalogError: string | null = null;
  // El catálogo solo hace falta si hay canciones de la nube; sin red, las de «Este dispositivo» se añaden igual.
  if (refs.some((ref) => !ref.local)) {
    try {
      const { catalog } = await loadCatalog();
      byId = new Map(catalog.songs.map((s) => [s.id, s]));
      byKey = new Map(catalog.songs.map((s) => [s.key, s]));
    } catch (e) {
      catalogError = `No pudimos consultar la biblioteca. ${reasonOf(e)}`;
      if (!refs.some((ref) => ref.local)) return { results, cancelled: false, stopReason: catalogError };
    }
  }

  let first = true;
  for (let index = 0; index < refs.length; index++) {
    const ref = refs[index];
    if (deps.signal.aborted) {
      for (const rest of refs.slice(index)) results.push({ title: rest.title, ok: false, reason: "Cancelada." });
      return { results, cancelled: true };
    }
    deps.onStart(index, refs.length, ref.title);
    if (ref.local) {
      const added = deps.addLocal ? deps.addLocal(ref, { master: first ? deps.master : undefined }) : false;
      if (added) first = false;
      results.push(added ? { title: ref.title, ok: true } : { title: ref.title, ok: false, reason: "No se pudo añadir al setlist." });
      continue;
    }
    if (catalogError) { results.push({ title: ref.title, ok: false, reason: catalogError }); continue; }
    const song = byId.get(ref.id) ?? byKey.get(ref.key);
    if (!song) { results.push({ title: ref.title, ok: false, reason: "Ya no está en la biblioteca." }); continue; }
    if (!isPlayable(song)) { results.push({ title: ref.title, ok: false, reason: "Próximamente: este formato aún no se puede abrir." }); continue; }
    const added = deps.addRef(
      { id: song.id, key: song.key, title: song.title, size: song.size, tone: song.tone, bpm: song.bpm },
      { config: ref.config, master: first ? deps.master : undefined },
    );
    if (added) first = false;
    results.push(added ? { title: ref.title, ok: true } : { title: ref.title, ok: false, reason: "No se pudo añadir al setlist." });
  }
  return { results, cancelled: false };
}
