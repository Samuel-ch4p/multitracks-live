import { useRef, useState } from "react";
import { songsFromPicked } from "./archive";

type Props = {
  onSongLoaded: (name: string, files: File[]) => void;
};

const ACCEPT = "audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.aif,.aiff,.zip,.rar";

export default function LocalImport({ onSongLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function handle(list: FileList | File[] | null) {
    const picked = list ? Array.from(list) : [];
    if (picked.length === 0) return;
    setBusy(true);
    setError("");
    setStatus("Leyendo archivos…");
    try {
      const songs = await songsFromPicked(picked, setStatus);
      if (songs.length === 0) {
        throw new Error("No encontré pistas compatibles. Elige audios (WAV, MP3, M4A, FLAC…) o un ZIP/RAR con las pistas.");
      }
      for (const song of songs) onSongLoaded(song.name, song.files);
      setStatus(songs.length === 1
        ? `Añadida: ${songs[0].name} · ${songs[0].files.length} pistas.`
        : `${songs.length} canciones añadidas.`);
    } catch (err) {
      console.error("Error al cargar archivos locales:", err);
      setError(err instanceof Error ? err.message : "No se pudieron leer los archivos.");
      setStatus("");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="local-source">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(event) => void handle(event.target.files)}
      />
      <button
        className={`pick-zone ${dragging ? "is-dragging" : ""}`}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handle(event.dataTransfer.files);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 7 8h3.5v6h3V8H17zM5 17h14v4H5z" /></svg>
        <strong>{busy ? "Procesando…" : "Elegir archivos del dispositivo"}</strong>
        <span>Pistas sueltas (WAV, MP3, M4A…), o un ZIP / RAR por canción. Puedes elegir varios.</span>
      </button>
      {status && <p className="status-message">{status}</p>}
      {error && <p className="error-message">{error}</p>}
      <p className="hint">Tip: si eliges pistas sueltas, se agrupan en una sola canción. Para varias canciones a la vez, elige un ZIP o RAR por canción.</p>
    </section>
  );
}
