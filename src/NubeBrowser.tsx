import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { pistas } from "./format";
import { useWindowed } from "./windowed";
import { CloudIcon, LoadCard } from "./CloudParts";
import { CloudError, friendlyCloudMessage } from "./cloud/errors";
import { fetchSongFiles, loadCatalog, type SongProgress } from "./cloud/cloudSource";
import { isPlayable, type CatalogArtist } from "./cloud/catalog";
import { buildIndex, foldQuery, searchIndex, type IndexData, type IndexSong } from "./searchIndex";
import { parseSongTags } from "./songTags";

type Props = {
  onSongLoaded: (name: string, files: File[], options?: { inMemory?: boolean }) => void;
};

/** Tocar una canción en los resultados de búsqueda: false = la selecciona y muestra "AÑADIR" (evita descargas grandes por error). */
const SEARCH_TAP_LOADS = false;
const SEARCH_DELAY_MS = 200;

// Caché en memoria de la sesión (el catálogo es solo texto): al cerrar y reabrir el panel no se vuelve a consultar.
let indexCache: IndexData | null = null;
let downloadInFlight = false;

const sizeLabel = (size?: number) => (size ? `${Math.round(size / 1048576)} MB` : "Multitrack");
const mb = (bytes: number) => (bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1);
const isAbort = (e: unknown) => e instanceof CloudError ? e.kind === "cancelled" : e instanceof DOMException && e.name === "AbortError";

function Tags({ song }: { song: IndexSong }) {
  const parsed = parseSongTags(song.title);
  const tone = song.tone ?? parsed.tone;
  const bpm = song.bpm ?? parsed.bpm;
  if (!tone && !bpm) return null;
  return (
    <span className="song-tags">
      {tone && <i className="tag">{tone}</i>}
      {bpm && <i className="tag">{Math.round(bpm)} BPM</i>}
    </span>
  );
}

type Load = { stage: "download" | "extract"; percent: number | null; detail: string };

export default function NubeBrowser({ onSongLoaded }: Props) {
  const [index, setIndex] = useState<IndexData | null>(indexCache);
  const [offline, setOffline] = useState(false);
  const [artist, setArtist] = useState<CatalogArtist | null>(null);
  const [loading, setLoading] = useState(() => !indexCache);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<IndexSong | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [load, setLoad] = useState<Load>({ stage: "download", percent: null, detail: "" });
  const [loadFail, setLoadFail] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const mounted = useRef(true);

  const busy = loading || adding;

  const fetchCatalog = useCallback(async () => {
    try {
      const { catalog, offline: isOffline } = await loadCatalog();
      indexCache = buildIndex(catalog);
      if (mounted.current) { setIndex(indexCache); setOffline(isOffline); setError(""); }
    } catch (e) {
      console.error("Nube: no se pudo cargar el catálogo");
      if (mounted.current) setError(friendlyCloudMessage(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  function reload() {
    setLoading(true);
    setError("");
    void fetchCatalog();
  }

  useEffect(() => {
    mounted.current = true;
    // Los setState ocurren después de la red, no de forma síncrona.
    /* oxlint-disable react/set-state-in-effect */
    void fetchCatalog();
    /* oxlint-enable react/set-state-in-effect */
    return () => { mounted.current = false; };
  }, [fetchCatalog]);

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
  function openArtist(item: CatalogArtist) {
    setQuery("");
    setSearch("");
    setArtist(item);
    setSelected(null);
    setError("");
    setStatus("");
  }

  function goBack() {
    setArtist(null);
    setSelected(null);
    setError("");
    setStatus("");
  }

  async function addSong(item: IndexSong) {
    if (!isPlayable(item)) return;
    if (downloadInFlight) { setError("Ya hay una canción descargándose. Espera a que termine."); return; }
    downloadInFlight = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setSelected(item);
    setAdding(true);
    setError("");
    setLoadFail(null);
    setLoad({ stage: "download", percent: null, detail: "" });
    const started = performance.now();
    let lastShown = 0;
    const onProgress = (p: SongProgress) => {
      const now = performance.now();
      if (now - lastShown < 250 && p.stage === "download") return;
      lastShown = now;
      if (p.stage === "download") {
        const speed = p.received / 1048576 / Math.max((now - started) / 1000, 0.1);
        setLoad({ stage: "download", percent: p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : null, detail: `${mb(p.received)} de ${mb(p.total)} MB · ${speed.toFixed(1)} MB/s` });
      } else {
        setLoad({ stage: "extract", percent: p.total ? Math.round((p.done / p.total) * 100) : null, detail: `Pista ${p.done} de ${p.total}` });
      }
    };
    try {
      const files = await fetchSongFiles(item, onProgress, controller.signal);
      if (controller.signal.aborted) throw new CloudError("cancelled");
      onSongLoaded(item.title, files, { inMemory: true });
      setSelected(null);
      setStatus(`Añadida: ${item.title} · ${pistas(files.length)}.`);
    } catch (e) {
      if (controller.signal.aborted || isAbort(e)) { if (mounted.current) setStatus("Descarga cancelada."); return; }
      console.error("Nube: error al descargar o extraer");
      // Los errores de extracción ya vienen en español ("El ZIP está dañado…"); los de la nube usan su mensaje amable.
      if (mounted.current) setLoadFail(e instanceof CloudError || e instanceof RangeError || !(e instanceof Error) || /fetch|network|abort/i.test(e.message)
        ? (e instanceof RangeError ? "Este multitrack es demasiado grande para la memoria del dispositivo. Cierra otras apps e inténtalo de nuevo." : friendlyCloudMessage(e))
        : e.message);
      setStatus("");
    } finally {
      downloadInFlight = false;
      abortRef.current = null;
      setAdding(false);
    }
  }

  function cancelAdd() { abortRef.current?.abort(); }

  function pickSong(song: IndexSong) {
    if (!isPlayable(song)) return;
    if (SEARCH_TAP_LOADS) { setSelected(song); void addSong(song); return; }
    setSelected(selected?.id === song.id ? null : song);
  }

  const artistSongs = artist ? index?.byArtist.get(artist.id) ?? [] : [];
  const artists = index?.artists ?? [];
  const connectionLabel = loading ? "Consultando biblioteca…" : error && !index ? "Error de conexión" : offline ? "Sin conexión · lista guardada" : index ? "Biblioteca conectada" : "Sin conectar";
  const connectionClass = loading ? "loading" : error && !index ? "error" : index ? "connected" : "idle";
  const refreshLabel = loading ? "CONECTANDO…" : error && !index ? "REINTENTAR" : "ACTUALIZAR";

  const songRow = (song: IndexSong, position: number, subtitle: string) => {
    const playable = isPlayable(song);
    const isSelected = selected?.id === song.id;
    return (
      <div className={`library-item archive ${isSelected ? "selected" : ""} ${playable ? "" : "soon"}`} key={song.id} style={{ "--i": Math.min(position, 12) } as CSSProperties}>
        <button className="library-item-main" disabled={busy || !playable} onClick={() => pickSong(song)}>
          <span className="item-icon"><CloudIcon name="archive" /></span>
          <span className="item-copy">
            <strong>{song.title}</strong>
            <small>{playable ? subtitle : `${subtitle} · Próximamente`}</small>
            <Tags song={song} />
          </span>
          {!isSelected && <span className="file-kind">{playable ? "ZIP" : "PRONTO"}</span>}
        </button>
        {isSelected && (
          <button className="add-song-button" disabled={busy} onClick={() => void addSong(song)}>
            {adding ? "PROCESANDO…" : "＋ AÑADIR"}
          </button>
        )}
      </div>
    );
  };
  const artistRow = (item: CatalogArtist, position: number) => (
    <div className="library-item folder" key={item.id} style={{ "--i": Math.min(position, 12) } as CSSProperties}>
      <button className="library-item-main" disabled={busy} onClick={() => openArtist(item)}>
        <span className="item-icon"><CloudIcon name="folder" /></span>
        <span className="item-copy"><strong>{item.name}</strong><small>{index?.byArtist.get(item.id)?.length ?? 0} canciones</small></span>
        <span className="item-chevron">›</span>
      </button>
    </div>
  );

  const indexNote = index ? `${index.songs.length} canciones · ${index.artists.length} artistas` : "";
  const foundArtists: CatalogArtist[] = result?.artists ?? [];
  // Listas por ventanas (la clave reinicia la ventana al cambiar de carpeta o de búsqueda)
  const listKey = `${artist?.id ?? "raiz"}|${search}`;
  const artistListWin = useWindowed(artists, listKey);
  const songListWin = useWindowed(artistSongs, listKey);
  const normalWin = artist ? songListWin : artistListWin;
  const foundArtistWin = useWindowed(foundArtists, listKey);
  const foundSongWin = useWindowed(result?.songs ?? [], listKey);
  const items = artist ? artistSongs : artists;

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
          <button className="refresh-library" disabled={busy} onClick={reload}>
            <CloudIcon name="refresh" />
            <span>{refreshLabel}</span>
          </button>
        </div>

        {index && (
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
        {index && indexNote && (
          <div className="index-note"><span>{indexNote}</span></div>
        )}

        {index && !searching && (
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
        {(status || error) && index && (
          <div className="library-notes">
            {status && <p className="status-message">{status}</p>}
            {error && <p className="error-message">{error}</p>}
          </div>
        )}

        {!index && !loading && (
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
        {index && !loading && searching && (
          <div className="library-results" aria-live="polite">
            {foundArtists.length > 0 && (
              <>
                <h3 className="result-title">ARTISTAS</h3>
                <div className="library-items">{foundArtistWin.visible.map((a, position) => artistRow(a, position))}</div>{foundArtistWin.sentinel}
              </>
            )}
            {result && result.songs.length > 0 && (
              <>
                <h3 className="result-title">CANCIONES{result.totalSongs > result.songs.length ? ` · ${result.songs.length} de ${result.totalSongs}` : ""}</h3>
                <div className="library-items">{foundSongWin.visible.map((s, position) => songRow(s, position, `${s.artist} · ${sizeLabel(s.size)}`))}</div>{foundSongWin.sentinel}
              </>
            )}
            {result && result.artists.length === 0 && result.songs.length === 0 && (
              <div className="library-state empty"><span className="state-icon"><CloudIcon name="folder" /></span><strong>Sin resultados</strong><span>Prueba con otras palabras o menos letras.</span></div>
            )}
          </div>
        )}

        {/* ---- Navegación normal ---- */}
        {index && !loading && !searching && items.length === 0 && (
          <div className="library-state empty">
            <span className="state-icon"><CloudIcon name="folder" /></span>
            <strong>{artist ? "Este artista no tiene canciones" : "La biblioteca está vacía"}</strong>
            <span>No se encontraron canciones ni multitracks.</span>
          </div>
        )}

        {index && !loading && !searching && items.length > 0 && (
          <div className="library-items">
            {artist
              ? artistSongs.length > 0 && songListWin.visible.map((song, position) => songRow(song, position, sizeLabel(song.size)))
              : artistListWin.visible.map((item, position) => artistRow(item, position))}
          </div>
        )}
        {index && !loading && !searching && items.length > 0 && normalWin.sentinel}
      </div>
      {(adding || loadFail) && (
        <LoadCard
          stage={load.stage}
          percent={load.percent}
          detail={load.detail}
          fileName={selected?.title ?? ""}
          error={loadFail}
          onCancel={adding ? cancelAdd : undefined}
          onRetry={loadFail && selected ? () => void addSong(selected) : undefined}
          onClose={() => setLoadFail(null)}
        />
      )}
    </>
  );
}
