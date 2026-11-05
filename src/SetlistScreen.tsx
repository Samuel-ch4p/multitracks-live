import type { ReactNode } from "react";
import { pistas } from "./format";
import { parseSongTags } from "./songTags";

export type SetlistItem = { id: number; name: string; tracks: number; tone?: string | null; bpm?: number | null };

type Props = {
  songs: SetlistItem[];
  activeId: number | null;
  playing: boolean;
  onOpen: (id: number) => void;
  onMove: (id: number, direction: -1 | 1) => void;
  onRemove: (id: number) => void;
  onAdd: () => void;
  /** Contenido adicional bajo el setlist actual (Mis setlists). */
  extra?: ReactNode;
};

const icons: Record<"up" | "down" | "x" | "plus" | "music", ReactNode> = {
  up: <path d="m6 14 6-6 6 6" />,
  down: <path d="m6 10 6 6 6-6" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  music: <><path d="M9 18V5l11-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>,
};
const Icon = ({ name }: { name: keyof typeof icons }) => <svg viewBox="0 0 24 24" aria-hidden="true">{icons[name]}</svg>;

/** Setlist: el repertorio de la sesión (en memoria). Solo muestra lo que la app sabe: nombre, pistas y tono/BPM leídos del nombre. */
export default function SetlistScreen({ songs, activeId, playing, onOpen, onMove, onRemove, onAdd, extra }: Props) {
  const totalTracks = songs.reduce((sum, song) => sum + song.tracks, 0);
  const activeIndex = songs.findIndex((song) => song.id === activeId);
  return (
    <section className="screen setlist-screen" aria-label="Setlist">
      <div className="lib-head">
        <div>
          <span className="eyebrow">TU REPERTORIO</span>
          <h1>Setlist</h1>
        </div>
        <button className="btn-primary compact" onClick={onAdd}><Icon name="plus" />Añadir</button>
      </div>

      {songs.length > 0 && (
        <div className="setlist-summary">
          <div><span className="eyebrow">CANCIONES</span><strong>{songs.length}</strong></div>
          <div><span className="eyebrow">PISTAS</span><strong>{totalTracks}</strong></div>
          <button className="btn-primary" disabled={activeIndex < 0} onClick={() => activeId !== null && onOpen(activeId)}>Abrir en el mezclador</button>
        </div>
      )}

      <div className="setlist-body">
      <div className="setlist-list">
        {songs.length === 0 && (
          <div className="lib-state empty">
            <span className="state-icon"><Icon name="music" /></span>
            <strong>Tu setlist está vacío</strong>
            <span>Añade canciones desde la Biblioteca para armar tu servicio.</span>
            <button className="btn-primary compact" onClick={onAdd}>Ir a la Biblioteca</button>
          </div>
        )}
        {songs.map((song, index) => {
          const parsed = parseSongTags(song.name);
          const tone = song.tone ?? parsed.tone;
          const bpm = song.bpm ? Math.round(song.bpm) : parsed.bpm;
          const active = song.id === activeId;
          return (
            <article className={`setlist-card ${active ? "active" : ""}`} key={song.id}>
              <button className="setlist-main" onClick={() => onOpen(song.id)} aria-label={`Abrir ${song.name}`}>
                <span className="setlist-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="song-copy">
                  <strong>{song.name}</strong>
                  <small>{active && playing ? "Reproduciendo · " : active ? "En el mezclador · " : ""}{pistas(song.tracks)}</small>
                </span>
                {(tone || bpm) && (
                  <span className="song-chips">
                    {tone && <i className="chip-tag">{tone}</i>}
                    {bpm && <i className="chip-tag">{bpm} BPM</i>}
                  </span>
                )}
              </button>
              <div className="setlist-actions">
                <button onClick={() => onMove(song.id, -1)} disabled={index === 0} aria-label={`Subir ${song.name}`}><Icon name="up" /></button>
                <button onClick={() => onMove(song.id, 1)} disabled={index === songs.length - 1} aria-label={`Bajar ${song.name}`}><Icon name="down" /></button>
                <button onClick={() => onRemove(song.id)} aria-label={`Quitar ${song.name}`}><Icon name="x" /></button>
              </div>
            </article>
          );
        })}
      </div>
      {extra}
      </div>
    </section>
  );
}
