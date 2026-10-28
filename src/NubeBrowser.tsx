import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { pistas } from "./format";
import { audioExtensions, sortFiles, zipToFilesAsync } from "./archive";
import { CloudIcon, LoadCard } from "./MegaBrowser";
import { DRIVE_API_KEY, DRIVE_ROOT_ID } from "./cloudConfig";
import { DriveError, downloadFile, friendlyDriveMessage, listArtists, listSongs, type DriveConfig, type DriveFile } from "./driveSource";
import { ageLabel, buildIndex, foldQuery, loadIndex, matchesAll, queryTokens, saveIndex, searchIndex, type IndexData, type IndexSong } from "./searchIndex";
import { parseSongTags } from "./songTags";

type Props = {
  onSongLoaded: (name: string, files: File[], options?: { inMemory?: boolean }) => void;
};

const cfg: DriveConfig = { apiKey: DRIVE_API_KEY };

/** Tocar una canción en los resultados de búsqueda: false = la selecciona y muestra "AÑADIR" (evita descargas grandes por error). */
const SEARCH_TAP_LOADS = false;
const SEARCH_DELAY_MS = 200;

// Caché en memoria de la sesión (solo nombres): al cerrar y reabrir el panel no se vuelve a consultar.
let artistsCache: DriveFile[] | null = null;
const songsCache = new Map<string, DriveFile[]>();
let indexCache: IndexData | null = null;
let indexJob: Promise<IndexData> | null = null;
let indexProgress = { done: 0, total: 0 };
let downloadInFlight = false;

const mb = (bytes: number) => (bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1);
const asSong = (song: IndexSong): DriveFile => ({ id: song.id, name: song.name, mimeType: "application/zip", size: song.size });
const sizeLabel = (size?: number) => (typeof size === "number" ? `${(size / 1048576).toFixed(0)} MB` : "Multitrack");

/**
 * Descarga y extrae una canción. Nada se guarda en el teléfono: vive solo en memoria mientras la app está abierta.
 * Una sola a la vez (el panel se desmonta al cerrarse: sin esta guarda se podía iniciar una segunda descarga grande).
 */
async function fetchSong(item: DriveFile, onStatus: (text: string) => void): Promise<{ songName: string; files: File[] }> {
  downloadInFlight = true;
  try {
    onStatus("Conectando para descargar...");
    const started = performance.now();
    let lastShown = 0;
    const blob = await downloadFile(item, (received, total) => {
      const now = performance.now();
      if (now - lastShown < 250) return;
      lastShown = now;
      const speed = received / 1048576 / Math.max((now - started) / 1000, 0.1);
      onStatus(`Descargando ${Math.round((received / total) * 100)}% · ${mb(received)} de ${mb(total)} MB · ${speed.toFixed(1)} MB/s`);
    }, cfg);

    onStatus("Extrayendo pistas...");
    const files = sortFiles(
      (await zipToFilesAsync(blob, (done, total) => onStatus(`Extrayendo pistas · ${done} de ${total}...`))).filter((file) => audioExtensions.test(file.name))
    );
    if (files.length === 0) throw new Error("No se encontraron pistas de audio compatibles en este archivo.");
    return { songName: item.name.replace(/\.zip$/i, ""), files };
  } finally {
    downloadInFlight = false;
  }
}

function Tags({ name }: { name: string }) {
  const { tone, bpm } = parseSongTags(name);
  if (!tone && !bpm) return null;
  return (
    <span className="song-tags">
      {tone && <i className="tag">{tone}</i>}
      {bpm && <i className="tag">{bpm} BPM</i>}
    </span>
  );
}

export default function NubeBrowser({ onSongLoaded }: Props) {
  const [artists, setArtists] = useState<DriveFile[] | null>(artistsCache);
  const [artist, setArtist] = useState<DriveFile | null>(null);
  const [songs, setSongs] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(() => !artistsCache && !!DRIVE_API_KEY && !!DRIVE_ROOT_ID);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<DriveFile | null>(null);
  const [error, setError] = useState(() => (!DRIVE_API_KEY || !DRIVE_ROOT_ID ? friendlyDriveMessage(new DriveError("config", 0, "sin configurar")) : ""));
  const [status, setStatus] = useState("");
  // Buscador
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [index, setIndex] = useState<IndexData | null>(indexCache);
  const [indexing, setIndexing] = useState(() => !!indexJob);
  const [indexError, setIndexError] = useState(false);
  const [progress, setProgress] = useState(indexProgress);
  const mounted = useRef(true);

  const busy = loading || adding;
  const configured = !!DRIVE_API_KEY && !!DRIVE_ROOT_ID;

  const fetchArtists = useCallback(async () => {
    try {
      const list = await listArtists(DRIVE_ROOT_ID, cfg);
      artistsCache = list;
      if (mounted.current) { setArtists(list); setError(""); }
    } catch (e) {
      console.error("Nube: no se pudo listar los artistas", e);
      if (mounted.current) setError(friendlyDriveMessage(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  /** Índice de búsqueda: de IndexedDB si existe; si no (o al pedir "Actualizar"), se construye en segundo plano. */
  const runIndex = useCallback(async (force: boolean) => {
    if (!configured) return;
    if (!force && indexCache) { setIndex(indexCache); return; }
    if (!indexJob) {
      indexJob = (async () => {
        if (!force) {
          const saved = await loadIndex(DRIVE_ROOT_ID);
          if (saved) return saved;
        }
        const data = await buildIndex(
          DRIVE_ROOT_ID,
          async () => (artistsCache ?? (await listArtists(DRIVE_ROOT_ID, cfg))).map((a) => ({ id: a.id, name: a.name })),
          async (a) => (await listSongs(a.id, cfg)).map((s) => ({ id: s.id, name: s.name, size: s.size })),
          { concurrency: 6, onProgress: (done, total) => { indexProgress = { done, total }; if (mounted.current) setProgress({ done, total }); } }
        );
        void saveIndex(data); // si IndexedDB falla, sigue en memoria
        return data;
      })();
    }
    setIndexing(true);
    setIndexError(false);
    try {
      const data = await indexJob;
      indexCache = data;
      if (mounted.current) setIndex(data);
    } catch (e) {
      console.error("Nube: no se pudo construir el índice de búsqueda", e);
      if (mounted.current) setIndexError(true);
    } finally {
      indexJob = null;
      if (mounted.current) setIndexing(false);
    }
  }, [configured]);

  /** Botón CONECTAR / ACTUALIZAR / REINTENTAR. */
  function reloadArtists() {
    if (!configured) { setError(friendlyDriveMessage(new DriveError("config", 0, "sin configurar"))); return; }
    setLoading(true);
    setError("");
    void fetchArtists();
  }

  // Al abrir el panel se conecta solo (la primera vez de la sesión; luego sale de la caché en memoria) y prepara el índice.
  useEffect(() => {
    mounted.current = true;
    // Los setState de estas dos llamadas ocurren después de la red o de IndexedDB, no de forma síncrona.
    /* oxlint-disable react/set-state-in-effect */
    if (!artistsCache && configured) void fetchArtists();
    if (configured && !indexCache) void runIndex(false);
    /* oxlint-enable react/set-state-in-effect */
    return () => { mounted.current = false; };
  }, [configured, fetchArtists, runIndex]);

  // Búsqueda en vivo con un pequeño retardo para no recalcular en cada tecla.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query), query ? SEARCH_DELAY_MS : 0);
    return () => window.clearTimeout(timer);
  }, [query]);

  // El teclado del celular no debe tapar los resultados: se reserva su altura como espacio al final de la lista.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => document.documentElement.style.setProperty("--kb", `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
    viewport.addEventListener("resize", update);
    update();
    return () => {
      viewport.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--kb");
    };
  }, []);

  const searching = foldQuery(search).length > 0;
  const result = useMemo(() => (index && searching ? searchIndex(index, search) : null), [index, search, searching]);
  // Mientras el índice se construye, los artistas ya se pueden buscar con la lista que ya está cargada.
  const quickArtists = useMemo(() => {
    if (!searching || index || !artists) return [];
    const tokens = queryTokens(search);
    return artists.filter((a) => matchesAll(foldQuery(a.name), tokens)).slice(0, 60);
  }, [artists, index, search, searching]);

  async function openArtist(item: DriveFile) {
    setQuery("");
    setSearch("");
    setArtist(item);
    setSelected(null);
    setError("");
    setStatus("");
    const cached = songsCache.get(item.id);
    if (cached) { setSongs(cached); return; }
    setSongs([]);
    setLoading(true);
    try {
      const list = await listSongs(item.id, cfg);
      songsCache.set(item.id, list);
      if (mounted.current) setSongs(list);
    } catch (e) {
      console.error("Nube: no se pudo abrir la carpeta", e);
      if (mounted.current) setError(friendlyDriveMessage(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  function goBack() {
    setArtist(null);
    setSongs([]);
    setSelected(null);
    setError("");
    setStatus("");
  }

  async function addSong(item: DriveFile) {
    if (downloadInFlight) { setError("Ya hay una canción descargándose. Espera a que termine."); return; }
    setAdding(true);
    setError("");
    try {
      const { songName, files } = await fetchSong(item, setStatus);
      onSongLoaded(songName, files, { inMemory: true });
      setSelected(null);
      setStatus(`Añadida: ${songName} · ${pistas(files.length)}.`);
    } catch (e) {
      console.error("Nube: error al descargar o extraer", e);
      // Los errores de extracción ya vienen en español ("El ZIP está dañado…"); los de red o cuota usan el mensaje amable.
      setError(e instanceof Error && !(e instanceof DriveError) && !(e instanceof RangeError) && !/fetch|network|abort/i.test(e.message) ? e.message : friendlyDriveMessage(e));
      setStatus("");
    } finally {
      setAdding(false);
    }
  }

  function pickSong(file: DriveFile) {
    if (SEARCH_TAP_LOADS) { setSelected(file); void addSong(file); return; }
    setSelected(selected?.id === file.id ? null : file);
  }

  const items = artist ? songs : artists ?? [];
  const connectionLabel = loading ? "Consultando biblioteca…" : error && !artists ? "Error de conexión" : artists ? "Biblioteca conectada" : "Sin conectar";
  const connectionClass = loading ? "loading" : error && !artists ? "error" : artists ? "connected" : "idle";
  const refreshLabel = loading ? "CONECTANDO…" : error && !artists ? "REINTENTAR" : "ACTUALIZAR";

  const songRow = (file: DriveFile, position: number, subtitle: string) => {
    const isSelected = selected?.id === file.id;
    return (
      <div className={`library-item archive ${isSelected ? "selected" : ""}`} key={file.id} style={{ "--i": Math.min(position, 12) } as CSSProperties}>
        <button className="library-item-main" disabled={busy} onClick={() => pickSong(file)}>
          <span className="item-icon"><CloudIcon name="archive" /></span>
          <span className="item-copy">
            <strong>{file.name.replace(/\.zip$/i, "")}</strong>
            <small>{subtitle}</small>
            <Tags name={file.name} />
          </span>
          {!isSelected && <span className="file-kind">ZIP</span>}
        </button>
        {isSelected && (
          <button className="add-song-button" disabled={busy} onClick={() => void addSong(file)}>
            {adding ? "PROCESANDO…" : "＋ AÑADIR"}
          </button>
        )}
      </div>
    );
  };
  const artistRow = (item: DriveFile, position: number) => (
    <div className="library-item folder" key={item.id} style={{ "--i": Math.min(position, 12) } as CSSProperties}>
      <button className="library-item-main" disabled={busy} onClick={() => void openArtist(item)}>
        <span className="item-icon"><CloudIcon name="folder" /></span>
        <span className="item-copy"><strong>{item.name}</strong><small>Artista</small></span>
        <span className="item-chevron">›</span>
      </button>
    </div>
  );

  const indexNote = indexing
    ? `Indexando biblioteca… ${progress.done}/${progress.total || "…"}`
    : indexError
      ? "No se pudo preparar la búsqueda de canciones."
      : index
        ? `Índice ${ageLabel(index.builtAt)} · ${index.songs.length} canciones${index.failed ? ` · ${index.failed} carpetas sin leer` : ""}`
        : "";
  const foundArtists: DriveFile[] = (result?.artists ?? quickArtists).map((a) => ({ id: a.id, name: a.name, mimeType: "folder" }));

  return (
    <>
      <div className="library-subbar">
        <div className="cloud-status">
          <div>
            <span className="cloud-label">NUBE</span>
            <span className={`connection-state ${connectionClass}`}>
              <i />
              {connectionLabel}
            </span>
          </div>
          <button
            className="refresh-library"
            disabled={busy}
            onClick={() => {
              if (artist) { songsCache.delete(artist.id); void openArtist(artist); } else reloadArtists();
            }}
          >
            <CloudIcon name="refresh" />
            <span>{refreshLabel}</span>
          </button>
        </div>

        {artists && (
          <div className="library-search" role="search">
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Buscar artista o canción"
              aria-label="Buscar artista o canción"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && <button className="search-clear" aria-label="Limpiar búsqueda" onClick={() => { setQuery(""); setSearch(""); }}>×</button>}
          </div>
        )}
        {artists && indexNote && (
          <div className="index-note">
            <span>{indexNote}</span>
            {!indexing && (
              <button disabled={busy} onClick={() => void runIndex(true)}>{indexError ? "REINTENTAR" : "ACTUALIZAR ÍNDICE"}</button>
            )}
          </div>
        )}

        {artists && !searching && (
          <div className="library-location">
            <button aria-label="Volver a la lista de artistas" disabled={!artist || busy} onClick={goBack}>
              <CloudIcon name="back" />
            </button>
            <div>
              <span>UBICACIÓN ACTUAL</span>
              <strong>{artist ? artist.name : "Mi biblioteca"}</strong>
            </div>
          </div>
        )}
      </div>

      <div className="library-scroll">
        {(status || error) && artists && (
          <div className="library-notes">
            {status && <p className="status-message">{status}</p>}
            {error && <p className="error-message">{error}</p>}
          </div>
        )}

        {!artists && !loading && (
          <div className={`library-state ${error ? "error" : "empty"}`}>
            <span className="state-icon"><CloudIcon name="cloud" /></span>
            <strong>{error ? "No pudimos conectar con la Nube Crescendo" : "Biblioteca Crescendo"}</strong>
            <span>{error || "Toca CONECTAR arriba para ver las canciones disponibles."}</span>
          </div>
        )}

        {loading && (
          <div className="library-loading" aria-label="Cargando contenido">
            {Array.from({ length: 4 }, (_, position) => (
              <div className="library-skeleton" key={position}>
                <span />
                <div><i /><i /></div>
              </div>
            ))}
          </div>
        )}

        {/* ---- Resultados de búsqueda ---- */}
        {artists && !loading && searching && (
          <div className="library-results" aria-live="polite">
            {!index && indexing && foundArtists.length === 0 && (
              <div className="library-state empty"><span className="state-icon"><CloudIcon name="refresh" /></span><strong>Preparando la búsqueda…</strong><span>{indexNote}</span></div>
            )}
            {foundArtists.length > 0 && (
              <>
                <h3 className="result-title">ARTISTAS</h3>
                <div className="library-items">{foundArtists.map((a, position) => artistRow(a, position))}</div>
              </>
            )}
            {result && result.songs.length > 0 && (
              <>
                <h3 className="result-title">CANCIONES{result.totalSongs > result.songs.length ? ` · ${result.songs.length} de ${result.totalSongs}` : ""}</h3>
                <div className="library-items">{result.songs.map((s, position) => songRow(asSong(s), position, `${s.artist} · ${sizeLabel(s.size)}`))}</div>
              </>
            )}
            {!index && indexing && foundArtists.length > 0 && <p className="hint">Las canciones aparecerán cuando termine de indexar ({progress.done}/{progress.total || "…"}).</p>}
            {indexError && !index && (
              <div className="library-state error"><span className="state-icon"><CloudIcon name="cloud" /></span><strong>La búsqueda de canciones no está lista</strong><span>Revisa tu conexión y toca REINTENTAR.</span></div>
            )}
            {((result && result.artists.length === 0 && result.songs.length === 0) || (!index && !indexing && !indexError && foundArtists.length === 0)) && (
              <div className="library-state empty"><span className="state-icon"><CloudIcon name="folder" /></span><strong>Sin resultados</strong><span>Prueba con otras palabras o menos letras.</span></div>
            )}
          </div>
        )}

        {/* ---- Navegación normal ---- */}
        {artists && !loading && !searching && items.length === 0 && (
          <div className="library-state empty">
            <span className="state-icon"><CloudIcon name="folder" /></span>
            <strong>{artist ? "Este artista no tiene canciones" : "La biblioteca está vacía"}</strong>
            <span>No se encontraron canciones ni multitracks.</span>
          </div>
        )}

        {artists && !loading && !searching && items.length > 0 && (
          <div className="library-items">
            {items.map((item, position) => (artist ? songRow(item, position, sizeLabel(item.size)) : artistRow(item, position)))}
          </div>
        )}
      </div>
      {adding && <LoadCard status={status} fileName={(selected?.name ?? "").replace(/\.zip$/i, "")} />}
    </>
  );
}
