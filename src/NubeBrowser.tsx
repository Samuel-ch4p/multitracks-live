import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useWindowed } from "./windowed";
import { CloudIcon } from "./CloudParts";
import { friendlyCloudMessage } from "./cloud/errors";
import { supportHint } from "./cloud/config";
import { loadCatalog } from "./cloud/cloudSource";
import { isPlayable, type CatalogArtist } from "./cloud/catalog";
import { buildIndex, foldQuery, searchIndex, type IndexData, type IndexSong } from "./searchIndex";
import { parseSongTags } from "./songTags";
import { libraryCache } from "./libraryCache";
import SearchBox from "./SearchBox";

type Props = {
  /** Añade la canción al setlist como referencia: no descarga nada (la ventana de memoria de App.tsx decide cuándo cargarla). */
  onSongRef: (item: { id: string; key: string; title: string; size: number; tone?: string | null; bpm?: number | null }) => void;
};

/** Tocar una canción en los resultados de búsqueda: false = la selecciona y muestra "AÑADIR" (evita descargas grandes por error). */
const SEARCH_TAP_LOADS = false;



const sizeLabel = (size?: number) => (size ? `${Math.round(size / 1048576)} MB` : "Multitrack");
const songsLabel = (n: number) => `${n} ${n === 1 ? "canción" : "canciones"}`;

function Chips({ song }: { song: IndexSong }) {
  const parsed = parseSongTags(song.title);
  const tone = song.tone ?? parsed.tone;
  const bpm = song.bpm ?? parsed.bpm;
  if (!tone && !bpm) return null;
  return (
    <span className="song-chips">
      {tone && <i className="chip-tag">{tone}</i>}
      {bpm && <i className="chip-tag">{Math.round(bpm)} BPM</i>}
    </span>
  );
}

type Filter = "all" | "available";

export default function NubeBrowser({ onSongRef }: Props) {
  const [index, setIndex] = useState<IndexData | null>(libraryCache.index);
  const [offline, setOffline] = useState(false);
  const [artist, setArtist] = useState<CatalogArtist | null>(null);
  const [loading, setLoading] = useState(() => !libraryCache.index);
  const [selected, setSelected] = useState<IndexSong | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  /** Límite diario alcanzado (lo informa el servidor al intentar descargar). */
  const [filter, setFilter] = useState<Filter>("all");
  // El texto que se escribe vive en SearchBox; aquí solo está el filtro ya asentado.
  const [search, setSearch] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const mounted = useRef(true);

  const busy = loading;

  const fetchCatalog = useCallback(async () => {
    try {
      // Solo desarrollo: ?catalog=demo usa un catálogo falso de ~2.460 canciones (ver devCatalog.ts); en el APK este bloque no existe.
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("catalog") === "demo") {
        const { makeDemoCatalog } = await import("./devCatalog");
        libraryCache.index = buildIndex(makeDemoCatalog());
        if (mounted.current) { setIndex(libraryCache.index); setOffline(false); setError(""); }
        return;
      }
      const { catalog, offline: isOffline } = await loadCatalog();
      libraryCache.index = buildIndex(catalog);
      if (mounted.current) { setIndex(libraryCache.index); setOffline(isOffline); setError(""); }
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

  // Cada búsqueda nueva empieza arriba de la lista (con el teclado abierto casi no hay alto y el primer resultado quedaba oculto).
  useEffect(() => {
    document.querySelector(".library-body")?.scrollTo({ top: 0 });
    document.querySelector(".library-scroll")?.scrollTo({ top: 0 });
  }, [search]);

  const searching = foldQuery(search).length > 0;
  const result = useMemo(() => (index && searching ? searchIndex(index, search) : null), [index, search, searching]);
  const visible = (songs: IndexSong[]) => (filter === "available" ? songs.filter(isPlayable) : songs);

  function openArtist(item: CatalogArtist) {
    setResetSignal((value) => value + 1);
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

  /** Añadir = poner la referencia en el setlist (instantáneo). La descarga la gestiona la ventana de memoria de App.tsx. */
  function addSong(item: IndexSong) {
    if (!isPlayable(item)) return;
    onSongRef({ id: item.id, key: item.key, title: item.title, size: item.size, tone: item.tone, bpm: item.bpm });
    setSelected(null);
    setStatus(`Añadida a tu setlist: ${item.title}.`);
  }

  function pickSong(song: IndexSong) {
    if (!isPlayable(song)) return;
    if (SEARCH_TAP_LOADS) { setSelected(song); void addSong(song); return; }
    setSelected(selected?.id === song.id ? null : song);
  }

  const artistSongs = useMemo(() => visible(artist ? index?.byArtist.get(artist.id) ?? [] : []), [artist, index, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const artists = index?.artists ?? [];
  const connection = loading ? "loading" : error && !index ? "error" : offline ? "offline" : index ? "connected" : "idle";
  const connectionLabel = { loading: "Consultando biblioteca…", error: "Error de conexión", offline: "Sin conexión · lista guardada", connected: "Biblioteca conectada", idle: "Sin conectar" }[connection];

  const songRow = (song: IndexSong, position: number, subtitle: string) => {
    const playable = isPlayable(song);
    const isSelected = selected?.id === song.id;
    return (
      <div className={`song-item ${isSelected ? "selected" : ""} ${playable ? "" : "soon"}`} key={song.id} style={{ "--i": Math.min(position, 12) } as CSSProperties}>
        <button className="song-item-main" disabled={busy || !playable} onClick={() => pickSong(song)}>
          <span className="song-art"><CloudIcon name="music" /></span>
          <span className="song-copy">
            <strong>{song.title}</strong>
            <small>{subtitle}</small>
          </span>
          <Chips song={song} />
          <span className="song-end">
            {!playable ? <i className="chip-tag soon-tag">Próximamente</i>
              : <CloudIcon name="plus" />}
          </span>
        </button>
        {isSelected && playable && (
          <button className="song-add" disabled={busy} onClick={() => addSong(song)}>
            ＋ AÑADIR A MI SETLIST
          </button>
        )}
      </div>
    );
  };
  const artistCard = (item: CatalogArtist, position: number) => (
    <button className="artist-card" key={item.id} disabled={busy} onClick={() => openArtist(item)} style={{ "--i": Math.min(position, 12) } as CSSProperties}>
      <span className="artist-initial" aria-hidden="true">{item.name.trim().charAt(0).toUpperCase() || "?"}</span>
      <span className="artist-copy"><strong>{item.name}</strong><small>{songsLabel(index?.byArtist.get(item.id)?.length ?? 0)}</small></span>
    </button>
  );

  const listKey = `${artist?.id ?? "raiz"}|${search}|${filter}`;
  const artistListWin = useWindowed(artists, listKey);
  const songListWin = useWindowed(artistSongs, listKey);
  const foundArtistWin = useWindowed(result?.artists ?? [], listKey);
  const foundSongs = useMemo(() => visible(result?.songs ?? []), [result, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const foundSongWin = useWindowed(foundSongs, listKey);
  const empty = (title: string, text: string) => (
    <div className="lib-state empty"><span className="state-icon"><CloudIcon name="music" /></span><strong>{title}</strong><span>{text}</span></div>
  );

  return (
    <>
      <div className="lib-toolbar">
        {index && (
          <SearchBox onSearch={setSearch} resetSignal={resetSignal} placeholder="Buscar artistas o canciones" label="Buscar artista o canción" />
        )}
        <button className="lib-refresh" disabled={busy} onClick={reload} aria-label={error && !index ? "Reintentar conexión" : "Actualizar catálogo"} title={error && !index ? "Reintentar" : "Actualizar"}>
          <CloudIcon name="refresh" />
        </button>
      </div>

      <div className="lib-meta">
        <span className={`connection-state ${connection}`}><i />{connectionLabel}</span>
        {index && <span className="lib-count">{index.songs.length} canciones · {index.artists.length} artistas</span>}
        {index && (
          <span className="lib-filters" role="group" aria-label="Filtrar canciones">
            <button className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Todas</button>
            <button className={filter === "available" ? "active" : ""} aria-pressed={filter === "available"} onClick={() => setFilter("available")}>Disponibles</button>
          </span>
        )}
      </div>


      <div className="library-scroll">
        {(status || error) && index && (
          <div className="library-notes">
            {status && <p className="status-message">{status}</p>}
            {error && <p className="error-message">{error}</p>}
          </div>
        )}

        {index && !searching && artist && (
          <div className="lib-back">
            <button aria-label="Volver a la lista de artistas" disabled={busy} onClick={goBack}><CloudIcon name="back" /></button>
            <div><small>ARTISTA</small><strong>{artist.name}</strong></div>
            <span>{songsLabel(index.byArtist.get(artist.id)?.length ?? 0)}</span>
          </div>
        )}

        {!index && !loading && (
          <div className={`lib-state ${error ? "error" : "empty"}`}>
            <span className="state-icon"><CloudIcon name="cloud" /></span>
            <strong>{error ? "No pudimos conectar con la Nube Crescendo" : "Biblioteca Crescendo"}</strong>
            <span>{error || "Toca actualizar para ver las canciones disponibles."}</span>
            {error && <small className="lib-support">{supportHint()}</small>}
          </div>
        )}

        {loading && (
          <div className="lib-loading" aria-label="Cargando contenido">
            {Array.from({ length: 5 }, (_, position) => (
              <div className="lib-skeleton" key={position}><span /><div><i /><i /></div></div>
            ))}
          </div>
        )}

        {/* ---- Resultados de búsqueda ---- */}
        {index && !loading && searching && (
          <div className="lib-results" aria-live="polite">
            {foundArtistWin.visible.length > 0 && (
              <>
                <h3 className="lib-title">ARTISTAS</h3>
                <div className="artist-grid">{foundArtistWin.visible.map((a, position) => artistCard(a, position))}</div>{foundArtistWin.sentinel}
              </>
            )}
            {foundSongs.length > 0 && (
              <>
                <h3 className="lib-title">CANCIONES{result && result.totalSongs > foundSongs.length ? ` · ${foundSongs.length} de ${result.totalSongs}` : ""}</h3>
                <div className="song-list">{foundSongWin.visible.map((s, position) => songRow(s, position, `${s.artist} · ${sizeLabel(s.size)}`))}</div>{foundSongWin.sentinel}
              </>
            )}
            {result && result.artists.length === 0 && foundSongs.length === 0 && empty("No encontramos canciones", "Prueba con otro artista o título.")}
          </div>
        )}

        {/* ---- Navegación normal ---- */}
        {index && !loading && !searching && !artist && (
          artists.length === 0
            ? empty("La biblioteca está vacía", "No se encontraron canciones ni multitracks.")
            : <><h3 className="lib-title">ARTISTAS</h3><div className="artist-grid">{artistListWin.visible.map((a, position) => artistCard(a, position))}</div>{artistListWin.sentinel}</>
        )}
        {index && !loading && !searching && artist && (
          artistSongs.length === 0
            ? empty(filter === "available" ? "Sin canciones disponibles" : "Este artista no tiene canciones", filter === "available" ? "Las de formato próximo aún no se pueden abrir." : "No se encontraron canciones ni multitracks.")
            : <><div className="song-list">{songListWin.visible.map((song, position) => songRow(song, position, sizeLabel(song.size)))}</div>{songListWin.sentinel}</>
        )}
      </div>
    </>
  );
}
