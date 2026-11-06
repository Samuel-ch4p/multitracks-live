import { loadCatalog, fetchSongFiles, type CatalogSong, type SongProgress } from "./cloud/cloudSource";
import { CloudError, friendlyCloudMessage } from "./cloud/errors";
import { isPlayable } from "./cloud/catalog";
import type { SavedSong, SongConfig, SongRef } from "./setlistStore";

export type QueueResult = { title: string; ok: boolean; reason?: string };

type Deps = {
  /** Añade la canción al setlist. Devuelve false si no se pudo (por ejemplo, sin memoria). */
  addSong: (title: string, files: File[], options: { inMemory: true; tone: string | null; bpm: number | null; ref: SongRef; config?: SongConfig; master?: number; noPrompt: true }) => boolean;
  onStart: (index: number, total: number, title: string) => void;
  onProgress: (progress: SongProgress) => void;
  signal: AbortSignal;
  /** Volumen master guardado con el culto; se aplica al cargar la primera canción. */
  master?: number;
};

const reasonOf = (e: unknown): string => {
  if (e instanceof CloudError) return friendlyCloudMessage(e);
  if (e instanceof RangeError) return "Es demasiado grande para la memoria del dispositivo.";
  if (e instanceof Error && !/fetch|network|abort/i.test(e.message)) return e.message;
  return friendlyCloudMessage(e);
};

/**
 * Carga un setlist guardado desde la nube, una canción tras otra (la misma descarga de siempre: una petición continua).
 * Si una falla, sigue con las demás; al final devuelve qué se cargó y qué no, y por qué. Se corta del todo solo si la sesión terminó
 * o la cuenta no está activa (afecta a todas), o si el usuario cancela.
 */
export async function runSetlistQueue(refs: SavedSong[], deps: Deps): Promise<{ results: QueueResult[]; cancelled: boolean; stopReason?: string }> {
  const results: QueueResult[] = [];
  let catalogSongs: Map<string, CatalogSong> | null = null;
  let byKey: Map<string, CatalogSong> | null = null;
  try {
    const { catalog } = await loadCatalog();
    catalogSongs = new Map(catalog.songs.map((s) => [s.id, s]));
    byKey = new Map(catalog.songs.map((s) => [s.key, s]));
  } catch (e) {
    return { results, cancelled: false, stopReason: `No pudimos consultar la biblioteca. ${reasonOf(e)}` };
  }

  for (let index = 0; index < refs.length; index++) {
    const ref = refs[index];
    if (deps.signal.aborted) {
      for (const rest of refs.slice(index)) results.push({ title: rest.title, ok: false, reason: "Cancelada." });
      return { results, cancelled: true };
    }
    deps.onStart(index, refs.length, ref.title);
    const song = catalogSongs.get(ref.id) ?? byKey.get(ref.key);
    if (!song) { results.push({ title: ref.title, ok: false, reason: "Ya no está en la biblioteca." }); continue; }
    if (!isPlayable(song)) { results.push({ title: ref.title, ok: false, reason: "Próximamente: este formato aún no se puede abrir." }); continue; }
    try {
      const files = await fetchSongFiles(song, deps.onProgress, deps.signal);
      const added = deps.addSong(song.title, files, { inMemory: true, tone: song.tone, bpm: song.bpm, ref: { id: song.id, key: song.key, title: song.title }, config: ref.config, master: deps.master, noPrompt: true });
      results.push(added ? { title: ref.title, ok: true } : { title: ref.title, ok: false, reason: "No hay memoria suficiente: quita canciones del setlist para añadirla." });
    } catch (e) {
      if (deps.signal.aborted || (e instanceof CloudError && e.kind === "cancelled")) {
        for (const rest of refs.slice(index)) results.push({ title: rest.title, ok: false, reason: "Cancelada." });
        return { results, cancelled: true };
      }
      if (e instanceof CloudError && (e.kind === "no_session" || e.isAccountState)) {
        results.push({ title: ref.title, ok: false, reason: friendlyCloudMessage(e) });
        for (const rest of refs.slice(index + 1)) results.push({ title: rest.title, ok: false, reason: "No se intentó." });
        return { results, cancelled: false, stopReason: friendlyCloudMessage(e) };
      }
      results.push({ title: ref.title, ok: false, reason: reasonOf(e) });
    }
  }
  return { results, cancelled: false };
}
