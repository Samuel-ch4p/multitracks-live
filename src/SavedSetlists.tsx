import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { loadSession, loadSetlists, newId, persistSetlists, type SavedSession, type SavedSetlist, type SavedSong, type SongConfig, type SongRef } from "./setlistStore";
import { runSetlistQueue, type QueueResult } from "./setlistQueue";
import { signOut } from "./cloud/auth";

type Props = {
  /** Dueño de los datos guardados (user_id de la cuenta). */
  userId: string;
  /** Canciones del setlist actual; `ref` solo existe en las que vienen de la nube. */
  current: { name: string; ref?: SongRef }[];
  /** Nombre del culto en curso (sugerido al guardar). */
  sessionName: string;
  onSessionName: (name: string) => void;
  /** Canciones de la nube del setlist actual con la configuración del mezclador de cada una. */
  getSnapshot: () => { songs: SavedSong[]; master: number };
  /** Avisa mientras se carga un culto (el autoguardado espera). */
  onBusyChange: (busy: boolean) => void;
  /** Vacía el setlist actual (false si hay algo en curso). */
  onClear: () => boolean;
  /** Añade una canción de la nube al setlist como referencia (no descarga: la ventana de memoria de la app decide cuándo). */
  onAddRef: (item: { id: string; key: string; title: string; size: number; tone: string | null; bpm: number | null }, options: { config?: SongConfig; master?: number }) => boolean;
};

/** Lo mínimo que hace falta para cargar: un culto guardado o la sesión autoguardada. */
type Loadable = { name: string; songs: SavedSong[]; master?: number };

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
  | { kind: "replace"; list: Loadable };

type Queue = {
  list: Loadable;
  index: number;
  total: number;
  title: string;
  percent: number | null;
  detail: string;
  /** Hay un resultado final (terminó, se canceló o se cortó). */
  done: { results: QueueResult[]; cancelled: boolean; stopReason?: string } | null;
};

const when = (time: number) => (time ? new Date(time).toLocaleDateString("es", { day: "numeric", month: "short" }).replace(".", "") : "");
const count = (n: number) => `${n} ${n === 1 ? "canción" : "canciones"}`;

/**
 * "Mis cultos": la sesión autoguardada ("Continuar") y los cultos guardados con nombre. Se guardan como referencias a canciones
 * de la nube más la configuración del mezclador de cada una, y se vuelven a cargar en cola. Nunca se guarda audio; las
 * canciones de "Este dispositivo" no se pueden restaurar y se omiten.
 */
export default function SavedSetlists({ userId, current, sessionName, onSessionName, getSnapshot, onBusyChange, onClear, onAddRef }: Props) {
  const [lists, setLists] = useState<SavedSetlist[]>([]);
  const [pending, setPending] = useState<SavedSession | null>(null);
  const [ready, setReady] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [note, setNote] = useState("");
  const [queue, setQueue] = useState<Queue | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const addRef = useRef(onAddRef);
  useEffect(() => { addRef.current = onAddRef; });

  useEffect(() => {
    let alive = true;
    void Promise.all([loadSetlists(userId), loadSession(userId)]).then(([loaded, session]) => {
      if (alive) { setLists(loaded); setPending(session); setReady(true); }
    });
    return () => { alive = false; setReady(false); };
  }, [userId]);

  const store = useCallback(async (next: SavedSetlist[]) => {
    setLists(next);
    if (!(await persistSetlists(userId, next))) setNote("No se pudo guardar en este dispositivo.");
  }, [userId]);

  const cloudCount = current.filter((song) => song.ref).length;
  const skipped = current.length - cloudCount;

  function askSave() {
    setNote("");
    if (cloudCount === 0) {
      setNote(current.length === 0 ? "Tu setlist está vacío: añade canciones de la nube para guardarlo." : "Solo se pueden guardar canciones de la nube. Las de «Este dispositivo» no se guardan.");
      return;
    }
    setDialog({ kind: "save", name: sessionName, skipped });
  }

  function confirmDialog() {
    if (!dialog) return;
    const name = ("name" in dialog ? dialog.name : "").trim();
    if (dialog.kind === "save") {
      if (!name) return;
      const now = Date.now();
      const { songs, master } = getSnapshot();
      void store([{ id: newId(), name, createdAt: now, updatedAt: now, master, songs }, ...lists]);
      onSessionName(name);
      setNote(`Guardado «${name}» con ${count(songs.length)} de la nube y su configuración del mezclador.${dialog.skipped > 0 ? ` ${dialog.skipped} de «Este dispositivo» no se guardan (no se pueden restaurar).` : ""}`);
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
    void store([{ ...list, id: newId(), name: `${list.name} (copia)`, createdAt: now, updatedAt: now, songs: JSON.parse(JSON.stringify(list.songs)) as SavedSong[] }, ...lists]);
  }

  function askLoad(list: Loadable) {
    setNote("");
    if (list.songs.length === 0) { setNote("Este culto no tiene canciones."); return; }
    if (current.length > 0) setDialog({ kind: "replace", list });
    else void start(list);
  }

  async function start(list: Loadable) {
    onBusyChange(true); // el autoguardado espera: vaciar el setlist para cargar no debe pisar lo guardado
    if (!onClear()) { onBusyChange(false); setNote("Espera a que termine lo que está en curso antes de cargar otro culto."); return; }
    onSessionName(list.name);
    const controller = new AbortController();
    abortRef.current = controller;
    setQueue({ list, index: 0, total: list.songs.length, title: list.songs[0]?.title ?? "", percent: null, detail: "", done: null });
    const outcome = await runSetlistQueue(list.songs, {
      addRef: (item, options) => addRef.current(item, options),
      onStart: (index, total, title) => setQueue((q) => (q ? { ...q, index, total, title, percent: null, detail: "Armando la lista" } : q)),
      signal: controller.signal,
      master: list.master,
    });
    abortRef.current = null;
    if (outcome.results.some((r) => !r.ok && /sesión terminó/i.test(r.reason ?? ""))) void signOut();
    // Todo bien: la hoja se cierra sola y la app descarga la primera canción (con su propio aviso de progreso); si hubo avisos, se muestran.
    const clean = !outcome.cancelled && !outcome.stopReason && outcome.results.every((r) => r.ok);
    setQueue((q) => (q && !clean ? { ...q, done: outcome } : null));
    onBusyChange(false);
  }

  const done = queue?.done ?? null;
  const loaded = done ? done.results.filter((r) => r.ok).length : 0;
  const failed = done ? done.results.filter((r) => !r.ok) : [];
  const showContinue = ready && !!pending && current.length === 0 && !queue;

  return (
    <section className="saved-setlists" aria-label="Mis cultos">
      {showContinue && pending && (
        <div className="continue-card" role="group" aria-label="Continuar la sesión anterior">
          <span className="song-copy">
            <strong>Continuar: {pending.name} ({count(pending.songs.length)})</strong>
            <small>No se descarga nada hasta que toques Cargar.</small>
          </span>
          <button className="pill-btn primary" onClick={() => void start(pending)}>CARGAR</button>
        </div>
      )}
      <div className="saved-head">
        <h3 className="lib-title">MIS CULTOS</h3>
        <button className="settings-action compact" onClick={askSave}><Glyph name="save" />Guardar el actual</button>
      </div>
      {note && <p className="status-message saved-note" role="status">{note}</p>}
      {ready && lists.length === 0 && <p className="saved-empty">Aún no guardaste ningún culto. Arma uno con canciones de la nube y toca «Guardar el actual»: se guardan los nombres, el orden y tu mezcla de cada canción, nunca el audio.</p>}
      <div className="saved-list">
        {lists.map((list) => (
          <article className="saved-card" key={list.id}>
            <button className="saved-main" onClick={() => askLoad(list)} aria-label={`Cargar ${list.name}`}>
              <span className="song-copy">
                <strong>{list.name}</strong>
                <small>{count(list.songs.length)}{list.updatedAt ? ` · ${when(list.updatedAt)}` : ""}</small>
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
        <div className="sheet-layer" role="dialog" aria-modal="true" aria-label="Cultos">
          <form className="sheet" onSubmit={(event) => { event.preventDefault(); confirmDialog(); }}>
            {(dialog.kind === "save" || dialog.kind === "rename") && (
              <>
                <h2>{dialog.kind === "save" ? "Guardar culto" : "Renombrar culto"}</h2>
                <label className="auth-field">
                  <span>Nombre</span>
                  <input autoFocus maxLength={60} value={dialog.name} onChange={(event) => setDialog({ ...dialog, name: event.target.value })} />
                </label>
                {dialog.kind === "save" && dialog.skipped > 0 && <p className="sheet-note">{dialog.skipped} {dialog.skipped === 1 ? "canción de «Este dispositivo» no se guardará" : "canciones de «Este dispositivo» no se guardarán"}: no se pueden restaurar desde la nube.</p>}
              </>
            )}
            {dialog.kind === "delete" && (<><h2>Borrar culto</h2><p>¿Borrar «{dialog.list.name}»? Esto no se puede deshacer.</p></>)}
            {dialog.kind === "replace" && (
              <>
                <h2>Cargar «{dialog.list.name}»</h2>
                <p>Se reemplazará tu setlist actual ({count(current.length)}) y se descargarán las {dialog.list.songs.length} del guardado desde la nube, una tras otra.</p>
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
        <div className="sheet-layer" role="dialog" aria-modal="true" aria-label="Cargando culto">
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
                <span className="eyebrow">{done.cancelled ? "CARGA CANCELADA" : loaded === 0 ? "NO SE PUDO CARGAR" : failed.length > 0 ? "CULTO CARGADO CON AVISOS" : "CULTO CARGADO"}</span>
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
