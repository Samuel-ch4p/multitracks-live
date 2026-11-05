import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { defaultSetlistName, loadSetlists, newId, persistSetlists, type SavedSetlist, type SongRef } from "./setlistStore";
import { runSetlistQueue, type QueueResult } from "./setlistQueue";
import { signOut } from "./cloud/auth";
import type { SongProgress } from "./cloud/cloudSource";

type Props = {
  /** Canciones del setlist actual; `ref` solo existe en las que vienen de la nube. */
  current: { name: string; ref?: SongRef }[];
  /** Vacía el setlist actual (false si hay algo en curso). */
  onClear: () => boolean;
  /** Añade una canción cargada (false si no se pudo, por ejemplo sin memoria). */
  onAddSong: (name: string, files: File[], options: { inMemory: true; tone: string | null; bpm: number | null; ref: SongRef; noPrompt: true }) => boolean;
};

const svg: Record<"edit" | "copy" | "trash" | "save", ReactNode> = {
  edit: <path d="m4 20 4-1 11-11-3-3L5 16l-1 4ZM14 7l3 3" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6" />,
  save: <path d="M5 4h11l3 3v13H5V4ZM8 4v5h7M8 20v-6h8v6" />,
};
const Glyph = ({ name }: { name: keyof typeof svg }) => <svg viewBox="0 0 24 24" aria-hidden="true">{svg[name]}</svg>;

type Dialog =
  | { kind: "save"; name: string; skipped: number }
  | { kind: "rename"; list: SavedSetlist; name: string }
  | { kind: "delete"; list: SavedSetlist }
  | { kind: "replace"; list: SavedSetlist };

type Queue = {
  list: SavedSetlist;
  index: number;
  total: number;
  title: string;
  percent: number | null;
  detail: string;
  /** Hay un resultado final (terminó, se canceló o se cortó). */
  done: { results: QueueResult[]; cancelled: boolean; stopReason?: string } | null;
};

const when = (time: number) => (time ? new Date(time).toLocaleDateString("es", { day: "numeric", month: "short" }).replace(".", "") : "");

/**
 * "Mis setlists": guarda el setlist actual como referencias a canciones de la nube y lo vuelve a cargar en cola.
 * Nunca guarda audio; las canciones de "Este dispositivo" no se pueden restaurar y se omiten al guardar.
 */
export default function SavedSetlists({ current, onClear, onAddSong }: Props) {
  const [lists, setLists] = useState<SavedSetlist[]>([]);
  const [ready, setReady] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [note, setNote] = useState("");
  const [queue, setQueue] = useState<Queue | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const addRef = useRef(onAddSong);
  useEffect(() => { addRef.current = onAddSong; });

  useEffect(() => {
    let alive = true;
    void loadSetlists().then((loaded) => { if (alive) { setLists(loaded); setReady(true); } });
    return () => { alive = false; };
  }, []);

  const store = useCallback(async (next: SavedSetlist[]) => {
    setLists(next);
    if (!(await persistSetlists(next))) setNote("No se pudo guardar en este dispositivo.");
  }, []);

  const cloudCount = current.filter((song) => song.ref).length;
  const skipped = current.length - cloudCount;

  function askSave() {
    setNote("");
    if (cloudCount === 0) {
      setNote(current.length === 0 ? "Tu setlist está vacío: añade canciones de la nube para guardarlo." : "Solo se pueden guardar canciones de la nube. Las de «Este dispositivo» no se guardan.");
      return;
    }
    setDialog({ kind: "save", name: defaultSetlistName(), skipped });
  }

  function confirmDialog() {
    if (!dialog) return;
    const name = ("name" in dialog ? dialog.name : "").trim();
    if (dialog.kind === "save") {
      if (!name) return;
      const now = Date.now();
      const songs = current.flatMap((song) => (song.ref ? [{ id: song.ref.id, key: song.ref.key, title: song.ref.title }] : []));
      void store([{ id: newId(), name, createdAt: now, updatedAt: now, songs }, ...lists]);
      setNote(`Guardado «${name}» con ${songs.length} ${songs.length === 1 ? "canción" : "canciones"} de la nube.${dialog.skipped > 0 ? ` ${dialog.skipped} de «Este dispositivo» no se guardan (no se pueden restaurar).` : ""}`);
    } else if (dialog.kind === "rename") {
      if (!name) return;
      void store(lists.map((l) => (l.id === dialog.list.id ? { ...l, name, updatedAt: Date.now() } : l)));
    } else if (dialog.kind === "delete") {
      void store(lists.filter((l) => l.id !== dialog.list.id));
    } else {
      setDialog(null);
      void start(dialog.list);
      return;
    }
    setDialog(null);
  }

  function duplicate(list: SavedSetlist) {
    const now = Date.now();
    void store([{ ...list, id: newId(), name: `${list.name} (copia)`, createdAt: now, updatedAt: now, songs: list.songs.map((s) => ({ ...s })) }, ...lists]);
  }

  function askLoad(list: SavedSetlist) {
    setNote("");
    if (list.songs.length === 0) { setNote("Este setlist no tiene canciones."); return; }
    if (current.length > 0) setDialog({ kind: "replace", list });
    else void start(list);
  }

  async function start(list: SavedSetlist) {
    if (!onClear()) { setNote("Espera a que termine lo que está en curso antes de cargar otro setlist."); return; }
    const controller = new AbortController();
    abortRef.current = controller;
    setQueue({ list, index: 0, total: list.songs.length, title: list.songs[0]?.title ?? "", percent: null, detail: "", done: null });
    const outcome = await runSetlistQueue(list.songs, {
      addSong: (title, files, options) => addRef.current(title, files, options),
      onStart: (index, total, title) => setQueue((q) => (q ? { ...q, index, total, title, percent: null, detail: "" } : q)),
      onProgress: (p: SongProgress) => setQueue((q) => (q ? (p.stage === "download"
        ? { ...q, percent: p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : null, detail: `Descargando · ${(p.received / 1048576).toFixed(0)} de ${(p.total / 1048576).toFixed(0)} MB` }
        : { ...q, percent: p.total ? Math.round((p.done / p.total) * 100) : null, detail: `Preparando pistas · ${p.done} de ${p.total}` }) : q)),
      signal: controller.signal,
    });
    abortRef.current = null;
    if (outcome.results.some((r) => !r.ok && /sesión terminó/i.test(r.reason ?? ""))) void signOut();
    setQueue((q) => (q ? { ...q, done: outcome } : q));
  }

  const done = queue?.done ?? null;
  const loaded = done ? done.results.filter((r) => r.ok).length : 0;
  const failed = done ? done.results.filter((r) => !r.ok) : [];

  return (
    <section className="saved-setlists" aria-label="Mis setlists">
      <div className="saved-head">
        <h3 className="lib-title">MIS SETLISTS</h3>
        <button className="settings-action compact" onClick={askSave}><Glyph name="save" />Guardar el actual</button>
      </div>
      {note && <p className="status-message saved-note" role="status">{note}</p>}
      {ready && lists.length === 0 && <p className="saved-empty">Aún no guardaste ningún setlist. Arma uno con canciones de la nube y toca «Guardar el actual»: solo se guardan los nombres y el orden, nunca el audio.</p>}
      <div className="saved-list">
        {lists.map((list) => (
          <article className="saved-card" key={list.id}>
            <button className="saved-main" onClick={() => askLoad(list)} aria-label={`Cargar ${list.name}`}>
              <span className="song-copy">
                <strong>{list.name}</strong>
                <small>{list.songs.length} {list.songs.length === 1 ? "canción" : "canciones"}{list.updatedAt ? ` · ${when(list.updatedAt)}` : ""}</small>
              </span>
              <span className="saved-load">CARGAR</span>
            </button>
            <div className="setlist-actions">
              <button onClick={() => setDialog({ kind: "rename", list, name: list.name })} aria-label={`Renombrar ${list.name}`}><Glyph name="edit" /></button>
              <button onClick={() => duplicate(list)} aria-label={`Duplicar ${list.name}`}><Glyph name="copy" /></button>
              <button onClick={() => setDialog({ kind: "delete", list })} aria-label={`Borrar ${list.name}`}><Glyph name="trash" /></button>
            </div>
          </article>
        ))}
      </div>

      {dialog && !queue && (
        <div className="sheet-layer" role="dialog" aria-modal="true" aria-label="Setlists">
          <form className="sheet" onSubmit={(event) => { event.preventDefault(); confirmDialog(); }}>
            {(dialog.kind === "save" || dialog.kind === "rename") && (
              <>
                <h2>{dialog.kind === "save" ? "Guardar setlist" : "Renombrar setlist"}</h2>
                <label className="auth-field">
                  <span>Nombre</span>
                  <input autoFocus maxLength={60} value={dialog.name} onChange={(event) => setDialog({ ...dialog, name: event.target.value })} />
                </label>
                {dialog.kind === "save" && dialog.skipped > 0 && <p className="sheet-note">{dialog.skipped} {dialog.skipped === 1 ? "canción de «Este dispositivo» no se guardará" : "canciones de «Este dispositivo» no se guardarán"}: no se pueden restaurar desde la nube.</p>}
              </>
            )}
            {dialog.kind === "delete" && (<><h2>Borrar setlist</h2><p>¿Borrar «{dialog.list.name}»? Esto no se puede deshacer.</p></>)}
            {dialog.kind === "replace" && (
              <>
                <h2>Cargar «{dialog.list.name}»</h2>
                <p>Se reemplazará tu setlist actual ({current.length} {current.length === 1 ? "canción" : "canciones"}) y se descargarán las {dialog.list.songs.length} del guardado desde la nube, una tras otra.</p>
              </>
            )}
            <div className="sheet-actions">
              <button type="button" className="pill-btn" onClick={() => setDialog(null)}>CANCELAR</button>
              <button type="submit" className={`pill-btn primary ${dialog.kind === "delete" ? "danger" : ""}`}>
                {dialog.kind === "delete" ? "BORRAR" : dialog.kind === "replace" ? "REEMPLAZAR Y CARGAR" : "GUARDAR"}
              </button>
            </div>
          </form>
        </div>
      )}

      {queue && (
        <div className="sheet-layer" role="dialog" aria-modal="true" aria-label="Cargando setlist">
          <div className="sheet">
            {!done ? (
              <>
                <span className="eyebrow">CARGANDO «{queue.list.name.toUpperCase()}»</span>
                <h2>Canción {queue.index + 1} de {queue.total}</h2>
                <p className="sheet-song">{queue.title}</p>
                <div className={`load-progress ${queue.percent === null ? "is-indeterminate" : ""}`} style={{ "--pct": queue.percent === null ? 0 : queue.percent / 100 } as React.CSSProperties}><span /></div>
                <div className="load-meta"><strong>{queue.percent === null ? "…" : `${queue.percent}%`}</strong><span>{queue.detail || "Conexión segura"}</span></div>
                <div className="sheet-actions"><button className="pill-btn" onClick={() => abortRef.current?.abort()}>CANCELAR</button></div>
              </>
            ) : (
              <>
                <span className="eyebrow">{done.cancelled ? "CARGA CANCELADA" : loaded === 0 ? "NO SE PUDO CARGAR" : failed.length > 0 ? "SETLIST CARGADO CON AVISOS" : "SETLIST CARGADO"}</span>
                <h2>{loaded} de {queue.total} {queue.total === 1 ? "canción cargada" : "canciones cargadas"}</h2>
                {done.stopReason && <p>{done.stopReason}</p>}
                {failed.length > 0 && (
                  <ul className="sheet-failed" aria-label="Canciones que no se pudieron cargar">
                    {failed.map((item, i) => (<li key={i}><strong>{item.title}</strong><small>{item.reason}</small></li>))}
                  </ul>
                )}
                <div className="sheet-actions"><button className="pill-btn primary" onClick={() => setQueue(null)}>LISTO</button></div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
