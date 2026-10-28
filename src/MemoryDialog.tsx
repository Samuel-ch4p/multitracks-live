import { useEffect, useRef } from "react";
import { pistas } from "./format";

export type MemorySong = { id: number; name: string; tracks: number; bytes: number; locked: boolean };

type Props = {
  incoming: { name: string; tracks: number; bytes: number };
  songs: MemorySong[];
  /** Bytes que quedan libres antes de añadir la canción nueva (puede ser negativo). */
  freeBytes: number;
  onRemove: (id: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const mb = (bytes: number) => `${Math.max(0, Math.round(bytes / 1048576))} MB`;

/**
 * Aviso de memoria llena: las canciones descargadas viven en la memoria del celular (nada se guarda en el dispositivo).
 * En lugar de quitar canciones en silencio, se deja elegir cuáles quitar del repertorio para hacer sitio.
 */
export default function MemoryDialog({ incoming, songs, freeBytes, onRemove, onConfirm, onCancel }: Props) {
  const fits = freeBytes >= incoming.bytes;
  const missing = incoming.bytes - freeBytes;
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (fits) confirmRef.current?.focus(); }, [fits]);
  return (
    <div className="load-layer memory-layer" role="alertdialog" aria-label="Memoria llena">
      <div className="load-card memory-card">
        <span className="eyebrow">MEMORIA LLENA</span>
        <h2>Quita una canción para añadir «{incoming.name}»</h2>
        <p className="memory-hint">
          {fits ? "Ya hay espacio. Puedes añadirla." : `Faltan ${mb(missing)} libres. Las canciones se guardan solo en la memoria mientras la app está abierta.`}
        </p>
        <ul className="memory-list">
          {songs.map((song) => (
            <li key={song.id}>
              <span className="memory-name"><strong>{song.name}</strong><small>{pistas(song.tracks)} · {mb(song.bytes)}</small></span>
              <button className="pill-btn" disabled={song.locked} onClick={() => onRemove(song.id)} aria-label={`Quitar ${song.name}`}>{song.locked ? "SONANDO" : "QUITAR"}</button>
            </li>
          ))}
          {songs.length === 0 && <li className="memory-empty">No hay canciones que quitar. Esta canción es demasiado grande para este dispositivo.</li>}
        </ul>
        <div className="load-actions">
          <button className="pill-btn" onClick={onCancel}>CANCELAR</button>
          <button ref={confirmRef} className="pill-btn primary" disabled={!fits} onClick={onConfirm}>AÑADIR</button>
        </div>
      </div>
    </div>
  );
}
