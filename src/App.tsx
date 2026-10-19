import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import "./App.css";
import MegaBrowser from "./MegaBrowser";
import LocalImport from "./LocalImport";
import Fader from "./Fader";
import Pan from "./Pan";
import Waveform from "./Waveform";
import logoUrl from "./assets/logo.png";
import Click from "./Click";
import Splash from "./Splash";
import Pads from "./Pads";
import { PadEngine } from "./padEngine";
import { Metronome } from "./metronome";
import { computePeaks } from "./archive";

type Track = {
  id: number;
  name: string;
  file: File;
  audio: HTMLAudioElement;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
};

type Song = {
  id: number;
  name: string;
  files: File[];
};

type AudioChannel = {
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  panner: StereoPannerNode;
};

let idCounter = 0;
const nextId = () => ++idCounter;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitUntilAtStart(audio: HTMLAudioElement) {
  const started = performance.now();
  while (true) {
    if (audio.error) throw new Error("No se pudo cargar una de las pistas.");
    if (!audio.seeking && audio.currentTime <= 0.03 && audio.paused) {
      await nextFrame();
      await nextFrame();
      if (audio.paused && !audio.seeking && audio.currentTime <= 0.03) return;
    }
    if (performance.now() - started > 8000) {
      throw new Error("Una pista tardó demasiado en reiniciarse.");
    }
    await nextFrame();
  }
}

async function resetAudio(audio: HTMLAudioElement) {
  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {
    // El navegador puede estar preparando el audio.
  }
  await waitUntilAtStart(audio);
}

function waitForSeek(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    if (!audio.seeking) return resolve();
    const done = () => {
      audio.removeEventListener("seeked", done);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, 2500);
    audio.addEventListener("seeked", done);
  });
}

/** Pista de referencia para el reloj y la sincronización: la más larga. */
function pickLead(active: Track[]): HTMLAudioElement {
  let lead = active[0].audio;
  for (const track of active) {
    const length = track.audio.duration;
    if (Number.isFinite(length) && (!Number.isFinite(lead.duration) || length > lead.duration)) lead = track.audio;
  }
  return lead;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function shortTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/** Quita de los nombres de pista el prefijo que comparten todas ("Jubilo - Bajo" → "Bajo"). */
function trackDisplayNames(names: string[]): string[] {
  if (names.length < 2) return names;
  let prefix = names[0];
  for (const name of names.slice(1)) {
    while (prefix && !name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  const boundary = prefix.search(/[\s\-_–.]+[^\s\-_–.]*$/);
  const cut = boundary >= 0 ? prefix.slice(0, boundary) + (prefix.slice(boundary).match(/^[\s\-_–.]+/)?.[0] ?? "") : "";
  if (cut.replace(/[\s\-_–.]+$/, "").length < 3) return names;
  const stripped = names.map((name) => name.slice(cut.length));
  return stripped.every((name) => name.length > 0) ? stripped : names;
}

function createTrack(file: File): Track {
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  audio.preload = "auto";
  audio.setAttribute("playsinline", "");
  audio.src = url;
  return {
    id: nextId(),
    name: file.name.replace(/\.[^/.]+$/, ""),
    file,
    audio,
    volume: 80,
    pan: 0,
    muted: false,
    solo: false,
  };
}

const PEAK_BUCKETS = 1500;

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Mantiene la pantalla encendida mientras `active` (en vivo el celular no debe dormirse). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) void next.release();
        else lock = next;
      } catch {
        // Sin permiso o sin soporte: no es crítico.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!lock || lock.released)) void request();
    };
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
}

type IconName = "metronome" | "restart" | "mixer" | "library" | "play";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    metronome: <><path d="M8 20h8l-1.8-16h-4.4L8 20Z" /><path d="m12 7 4 7M10 16h4" /></>,
    restart: <><path d="M4 12a8 8 0 1 0 2.6-5.9" /><path d="M4 4v4.5h4.5" /></>,
    mixer: <><path d="M5 4v16M12 4v16M19 4v16" /><circle cx="5" cy="9" r="2" /><circle cx="12" cy="15" r="2" /><circle cx="19" cy="8" r="2" /></>,
    library: <><path d="M4 4v16M9 4v16" /><path d="m14 5 4-1 3 15-4 1-3-15Z" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>;
}

type ChannelStripProps = {
  track: Track;
  index: number;
  displayName: string;
  dimmed: boolean;
  onChange: (id: number, changes: Partial<Track>) => void;
  onRemove: (id: number) => void;
};

/** Un canal del mezclador. Con memo, mover un fader solo vuelve a pintar ese canal (y no los demás ni la pantalla entera). */
const ChannelStrip = memo(function ChannelStrip({ track, index, displayName, dimmed, onChange, onRemove }: ChannelStripProps) {
  return (
    <article className={`channel ${dimmed ? "is-dimmed" : ""}`}>
      <div className="channel-head">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <div className="chip-row">
          <button className={`chip mute ${track.muted ? "active" : ""}`} onClick={() => onChange(track.id, { muted: !track.muted })} aria-pressed={track.muted} aria-label={`Silenciar ${track.name}`}>M</button>
          <button className={`chip solo ${track.solo ? "active" : ""}`} onClick={() => onChange(track.id, { solo: !track.solo })} aria-pressed={track.solo} aria-label={`Solo ${track.name}`}>S</button>
        </div>
      </div>
      <div className="fader-wrap">
        <Fader value={track.volume} onChange={(volume) => onChange(track.id, { volume })} label={`Volumen de ${track.name}`} dimmed={dimmed} />
      </div>
      <Pan value={track.pan} label={`Paneo de ${track.name}`} onChange={(pan) => onChange(track.id, { pan })} />
      <div className="channel-name">
        <strong title={track.name}>{displayName}</strong>
        <small>{track.volume}</small>
      </div>
      <button className="channel-remove" onClick={() => onRemove(track.id)} aria-label={`Eliminar pista ${track.name}`}>×</button>
    </article>
  );
});

function Artwork({ index }: { index: number }) {
  return (
    <div className={`artwork a${index % 5}`} aria-hidden="true">
      <div className="art-orbit one" />
      <div className="art-orbit two" />
      <span>CRESCENDO</span>
    </div>
  );
}

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [activeSongId, setActiveSongId] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [songName, setSongName] = useState("Añade una canción");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [masterVolume, setMasterVolume] = useState(85);
  const [showLibrary, setShowLibrary] = useState(false);
  const [source, setSource] = useState<"local" | "cloud">("local");
  // Las pruebas automáticas (navegador sin cabeza) se saltan la pantalla de inicio.
  const [showSplash, setShowSplash] = useState(() => !navigator.webdriver);
  const [tab, setTab] = useState<"library" | "live" | "mixer">("live");
  const [showClick, setShowClick] = useState(false);
  const [metronome] = useState(() => new Metronome());
  const [pad] = useState(() => new PadEngine());
  const padState = useSyncExternalStore(pad.subscribe, pad.getState);
  const wide = useMediaQuery("(min-width: 900px) and (min-height: 521px)");
  const [padOpen, setPadOpen] = useState(false);
  const click = useSyncExternalStore(metronome.subscribe, metronome.getState);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [peaksLoading, setPeaksLoading] = useState(false);

  const contextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const channelsRef = useRef<Map<number, AudioChannel>>(new Map());
  const tracksRef = useRef<Track[]>([]);
  const playlistRef = useRef<Song[]>([]);
  const activeSongIdRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const busyRef = useRef(false);
  const masterVolumeRef = useRef(masterVolume);

  masterVolumeRef.current = masterVolume;

  function getContext(): AudioContext {
    if (!contextRef.current) {
      const AudioContextClass = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error("Este navegador no admite Web Audio API.");
      const context = new AudioContextClass();
      const master = context.createGain();
      master.gain.value = masterVolumeRef.current / 100;
      master.connect(context.destination);
      contextRef.current = context;
      masterGainRef.current = master;
    }
    return contextRef.current;
  }

  function applyMix(list: Track[]) {
    const context = contextRef.current;
    if (!context) return;
    masterGainRef.current?.gain.setTargetAtTime(masterVolumeRef.current / 100, context.currentTime, 0.015);
    const hasSolo = list.some((track) => track.solo);
    for (const track of list) {
      const channel = channelsRef.current.get(track.id);
      if (!channel) continue;
      const silent = track.muted || (hasSolo && !track.solo);
      channel.gain.gain.setTargetAtTime(silent ? 0 : track.volume / 100, context.currentTime, 0.015);
      channel.panner.pan.setTargetAtTime(track.pan, context.currentTime, 0.015);
    }
  }

  function releaseTrack(track: Track) {
    track.audio.pause();
    const url = track.audio.src;
    track.audio.removeAttribute("src");
    track.audio.load();
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    const channel = channelsRef.current.get(track.id);
    if (channel) {
      channel.source.disconnect();
      channel.panner.disconnect();
      channel.gain.disconnect();
      channelsRef.current.delete(track.id);
    }
  }

  function setPlayState(isPlaying: boolean, isPaused: boolean) {
    playingRef.current = isPlaying;
    setPlaying(isPlaying);
    setPaused(isPaused);
  }

  function disposeActiveTracks() {
    for (const track of tracksRef.current) releaseTrack(track);
    tracksRef.current = [];
    setTracks([]);
    setPlayState(false, false);
    setCurrentTime(0);
    setDuration(0);
    setPeaks(null);
  }

  function loadSong(song: Song) {
    disposeActiveTracks();
    const nextTracks = song.files.map(createTrack);
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    activeSongIdRef.current = song.id;
    setActiveSongId(song.id);
    setSongName(song.name);
  }

  function activateSong(song: Song) {
    if (busyRef.current) return;
    loadSong(song);
    setStatusMessage(`${song.name} · ${song.files.length} pistas`);
  }

  const addSong = useCallback((name: string, files: File[]) => {
    if (!Array.isArray(files) || files.length === 0) {
      setStatusMessage(`No se pudo añadir ${name}: no contiene pistas válidas.`);
      return;
    }
    const song: Song = { id: nextId(), name, files };
    const next = [...playlistRef.current, song];
    playlistRef.current = next;
    setPlaylist(next);
    setStatusMessage(`${name} añadida a la lista (${files.length} pistas).`);
    if (activeSongIdRef.current === null) loadSong(song);
    // loadSong solo toca refs y estado de React; no depende de renders previos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectSong(song: Song) {
    if (song.id === activeSongIdRef.current || busyRef.current) return;
    activateSong(song);
  }

  function stepSong(direction: -1 | 1) {
    const list = playlistRef.current;
    if (busyRef.current || list.length === 0) return;
    const index = list.findIndex((song) => song.id === activeSongIdRef.current);
    const target = list[index + direction];
    if (target) activateSong(target);
  }

  function removeSong(songId: number) {
    if (busyRef.current) return;
    const next = playlistRef.current.filter((song) => song.id !== songId);
    playlistRef.current = next;
    setPlaylist(next);
    if (songId !== activeSongIdRef.current) return;
    if (next.length > 0) activateSong(next[0]);
    else {
      disposeActiveTracks();
      activeSongIdRef.current = null;
      setActiveSongId(null);
      setSongName("Añade una canción");
      setStatusMessage("La lista está vacía.");
    }
  }

  function changeTrack(id: number, changes: Partial<Track>) {
    const next = tracksRef.current.map((track) => (track.id === id ? { ...track, ...changes } : track));
    tracksRef.current = next;
    setTracks(next);
  }

  async function playAll() {
    if (busyRef.current) return;
    const currentTracks = [...tracksRef.current];
    if (currentTracks.length === 0) {
      setStatusMessage("Añade una canción y selecciónala primero.");
      return;
    }
    busyRef.current = true;
    setResetting(true);
    setPlayState(false, false);
    setStatusMessage("Sincronizando las pistas...");
    try {
      const context = getContext();
      await context.resume();
      await Promise.all(currentTracks.map((track) => resetAudio(track.audio)));
      for (const track of currentTracks) {
        if (channelsRef.current.has(track.id)) continue;
        const source = context.createMediaElementSource(track.audio);
        const panner = context.createStereoPanner();
        const gain = context.createGain();
        source.connect(panner);
        panner.connect(gain);
        gain.connect(masterGainRef.current ?? context.destination);
        channelsRef.current.set(track.id, { source, panner, gain });
      }
      applyMix(tracksRef.current);
      await Promise.all(currentTracks.map((track) => waitUntilAtStart(track.audio)));
      await Promise.all(currentTracks.map((track) => track.audio.play()));
      setPlayState(true, false);
      setStatusMessage(`Reproduciendo: ${songName}`);
    } catch (error) {
      console.error("Error al reproducir:", error);
      for (const track of tracksRef.current) {
        track.audio.pause();
        try { track.audio.currentTime = 0; } catch { /* Audio aún cargando. */ }
      }
      setPlayState(false, false);
      setStatusMessage(error instanceof Error ? `No se pudo reproducir: ${error.message}` : "No se pudo iniciar la secuencia.");
    } finally {
      busyRef.current = false;
      setResetting(false);
    }
  }

  function pauseAll() {
    if (busyRef.current) return;
    tracksRef.current.forEach((track) => track.audio.pause());
    setPlayState(false, true);
    setStatusMessage("Reproducción pausada.");
  }

  async function resumeAll() {
    if (busyRef.current) return;
    const currentTracks = tracksRef.current;
    if (!currentTracks.length) return;
    try {
      await getContext().resume();
      await Promise.all(currentTracks.map((track) => track.audio.play()));
      setPlayState(true, false);
      setStatusMessage(`Continuando: ${songName}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? `No se pudo continuar: ${error.message}` : "No se pudo continuar la reproducción.");
    }
  }

  async function stopAll() {
    if (busyRef.current) return;
    busyRef.current = true;
    setResetting(true);
    setPlayState(false, false);
    try {
      await Promise.all(tracksRef.current.map((track) => resetAudio(track.audio)));
      setCurrentTime(0);
      setStatusMessage("Detenido. Las pistas están en cero.");
    } catch (error) {
      console.error("Error al detener:", error);
      setStatusMessage("No se pudieron reiniciar todas las pistas.");
    } finally {
      busyRef.current = false;
      setResetting(false);
    }
  }

  async function seekTo(fraction: number) {
    const list = tracksRef.current;
    if (busyRef.current || !list.length || duration <= 0) return;
    busyRef.current = true;
    const wasPlaying = playingRef.current;
    const target = fraction * duration;
    try {
      list.forEach((track) => track.audio.pause());
      list.forEach((track) => {
        try { track.audio.currentTime = Math.min(target, track.audio.duration || target); } catch { /* aún cargando */ }
      });
      await Promise.all(list.map((track) => waitForSeek(track.audio)));
      setCurrentTime(target);
      if (wasPlaying) await Promise.all(list.map((track) => track.audio.play()));
    } catch (error) {
      console.error("Error al mover la posición:", error);
      setPlayState(false, true);
    } finally {
      busyRef.current = false;
    }
  }

  function removeTrack(id: number) {
    if (busyRef.current) return;
    const track = tracksRef.current.find((item) => item.id === id);
    if (!track) return;
    releaseTrack(track);
    const next = tracksRef.current.filter((item) => item.id !== id);
    tracksRef.current = next;
    setTracks(next);
    setStatusMessage("Pista eliminada del mezclador.");
  }

  function togglePlay() {
    if (playing) pauseAll();
    else if (paused) void resumeAll();
    else void playAll();
  }

  // Tiempo, duración, fin de canción y corrección de desfase entre pistas.
  const lastSecondRef = useRef(-1);
  const lastTimeRef = useRef(0);
  const lastDurationRef = useRef(0);
  const getProgress = useCallback(() => {
    const active = tracksRef.current;
    if (!active.length) return 0;
    const lead = pickLead(active);
    let longest = 0;
    for (const track of active) {
      const length = track.audio.duration;
      if (Number.isFinite(length) && length > longest) longest = length;
    }
    return longest > 0 ? (lead.currentTime || 0) / longest : 0;
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const active = tracksRef.current;
      if (!active.length) {
        setCurrentTime(0);
        setDuration(0);
        return;
      }
      // La pista de referencia es la más larga: si fuera una corta, su reloj se congelaría al terminar
      // y la corrección de desfase devolvería las demás pistas a ese punto.
      const lead = pickLead(active);
      // El estado de React (textos de tiempo) solo cambia cuando cambia el segundo que se muestra:
      // la barra de la forma de onda se mueve aparte, en cada fotograma, sin pasar por React.
      const now = lead.currentTime || 0;
      const shownSecond = Math.floor(now);
      if (shownSecond !== lastSecondRef.current || (!playingRef.current && Math.abs(now - lastTimeRef.current) > 0.02)) {
        lastSecondRef.current = shownSecond;
        lastTimeRef.current = now;
        setCurrentTime(now);
      }
      const known = active.map((track) => track.audio.duration).filter(Number.isFinite);
      const longest = known.length ? Math.max(...known) : 0;
      if (longest !== lastDurationRef.current) {
        lastDurationRef.current = longest;
        setDuration(longest);
      }

      if (!playingRef.current || busyRef.current) return;
      if (active.every((track) => track.audio.ended)) {
        void stopAll();
        return;
      }
      if (lead.ended) return;
      for (const track of active) {
        if (track.audio === lead) continue;
        if (!track.audio.ended && Math.abs(track.audio.currentTime - lead.currentTime) > 0.08) {
          try { track.audio.currentTime = lead.currentTime; } catch { /* aún cargando */ }
        }
      }
    }, 150);
    return () => window.clearInterval(timer);
    // stopAll solo usa refs y setters estables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useWakeLock(playing || click.running || padState.playing);

  useEffect(() => () => metronome.dispose(), [metronome]);
  useEffect(() => () => pad.dispose(), [pad]);

  useEffect(() => {
    applyMix(tracks);
    // applyMix lee solo refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, masterVolume]);

  // Forma de onda de la canción activa.
  useEffect(() => {
    const song = playlistRef.current.find((item) => item.id === activeSongId);
    if (!song) return;
    let cancelled = false;
    setPeaksLoading(true);
    computePeaks(song.files, PEAK_BUCKETS, () => cancelled, (partial) => {
      if (!cancelled) setPeaks(partial);
    })
      .then((result) => { if (!cancelled && result) setPeaks(result); })
      .finally(() => { if (!cancelled) setPeaksLoading(false); });
    return () => { cancelled = true; };
  }, [activeSongId]);

  useEffect(() => {
    return () => {
      for (const track of tracksRef.current) releaseTrack(track);
      if (contextRef.current) void contextRef.current.close();
      contextRef.current = null;
      masterGainRef.current = null;
    };
    // releaseTrack solo usa refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const activeIndex = playlist.findIndex((song) => song.id === activeSongId);
  const hasSolo = tracks.some((track) => track.solo);
  const displayNames = trackDisplayNames(tracks.map((track) => track.name));
  // Manejadores estables (siempre llaman a la versión más reciente) para que los canales con memo no se repinten sin motivo.
  const trackActions = useRef({ changeTrack, removeTrack });
  trackActions.current = { changeTrack, removeTrack };
  const onTrackChange = useCallback((id: number, changes: Partial<Track>) => trackActions.current.changeTrack(id, changes), []);
  const onTrackRemove = useCallback((id: number) => trackActions.current.removeTrack(id), []);
  const ready = tracks.length > 0 && !resetting;
  const syncLabel = resetting ? "Sincronizando…" : playing ? "En vivo" : ready ? "Pistas sincronizadas" : "Sin canción";

  const openLibrary = () => { setShowClick(false); setPadOpen(false); setShowLibrary(true); };
  const openClick = () => { setShowLibrary(false); setPadOpen(false); setShowClick(true); };
  // En pantalla ancha el panel va junto al mezclador; en celular se abre como cajón.
  const padInline = wide && padOpen;
  const padDrawer = !wide && padOpen;

  const songDeck = (
    <div className="song-deck" aria-label="Repertorio">
      {playlist.length === 0 && (
        <button className="deck-empty" onClick={openLibrary}>Tu repertorio está vacío · toca aquí para añadir canciones</button>
      )}
      {playlist.map((song, index) => (
        <article className={`deck-card ${song.id === activeSongId ? "active" : ""}`} key={song.id}>
          <button className="deck-main" onClick={() => selectSong(song)} title={song.name} aria-label={`Seleccionar ${song.name}`}>
            <Artwork index={index} />
            <span><strong>{song.name}</strong><small>{song.files.length} pistas</small></span>
          </button>
          <button className="deck-remove" onClick={() => removeSong(song.id)} aria-label={`Quitar ${song.name}`}>×</button>
        </article>
      ))}
      {playlist.length > 0 && <button className="deck-add" onClick={openLibrary} aria-label="Añadir canciones">＋</button>}
    </div>
  );

  const mixer = (
    <div className="channels-box">
      {tracks.length === 0 && <div className="mixer-empty">Selecciona una canción del repertorio para cargar sus pistas.</div>}
      <div className="channels" hidden={tracks.length === 0}>
        {tracks.map((track, index) => (
          <ChannelStrip
            key={track.id}
            track={track}
            index={index}
            displayName={displayNames[index]}
            dimmed={track.muted || (hasSolo && !track.solo)}
            onChange={onTrackChange}
            onRemove={onTrackRemove}
          />
        ))}
        <article className="channel master">
          <div className="channel-head">MASTER</div>
          <div className="fader-wrap">
            <Fader value={masterVolume} onChange={setMasterVolume} label="Volumen master" />
          </div>
          <div className="master-readout">{masterVolume}%</div>
          <div className="channel-name"><strong>Salida</strong></div>
        </article>
      </div>
    </div>
  );

  return (
    <main className="app">
      {showSplash && <Splash onDone={() => setShowSplash(false)} />}
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="" />
          <div className="brand-text">
            <strong>CRESCENDO</strong>
            <span>Live Multitracks</span>
          </div>
        </div>

        <div className="hud">
          <button className="tempo" onClick={openClick} aria-label="Ajustar tempo del click">
            <small>BPM</small>
            <small>{click.beats}/4</small>
            <strong>{click.bpm}</strong>
          </button>
          <button
            className={`glass-btn click-btn ${click.running ? "is-running" : ""}`}
            onClick={() => (click.running ? metronome.stop() : void metronome.start())}
            aria-pressed={click.running}
            aria-label="Activar o detener el click"
          >
            <Icon name="metronome" /><span className="btn-label">CLICK</span>
          </button>
          <button
            className={`glass-btn pad-btn ${padState.playing ? "is-running" : ""} ${padOpen ? "is-open" : ""}`}
            onClick={() => { setShowClick(false); setShowLibrary(false); setPadOpen((value) => !value); }}
            aria-pressed={padOpen}
            aria-label="Abrir el panel de pads"
          >
            PAD
          </button>
          <div className="clock">
            <strong>{formatTime(currentTime)}</strong>
            <span>{shortTime(currentTime)} / {shortTime(duration)}</span>
          </div>
        </div>

        <div className="transport">
          <button className="icon-btn" onClick={() => stepSong(-1)} disabled={resetting || activeIndex <= 0} aria-label="Canción anterior">
            <svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
          </button>
          <button
            className={`play-btn ${playing ? "is-playing" : ""}`}
            onClick={togglePlay}
            disabled={resetting || tracks.length === 0}
            aria-label={playing ? "Pausar" : "Reproducir"}
          >
            {resetting ? <span className="spinner" /> : playing
              ? <svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
              : <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
          </button>
          <button className="icon-btn" onClick={() => void stopAll()} disabled={resetting || tracks.length === 0} aria-label="Detener">
            <svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
          </button>
          <button className="icon-btn" onClick={() => stepSong(1)} disabled={resetting || activeIndex < 0 || activeIndex >= playlist.length - 1} aria-label="Canción siguiente">
            <svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
          </button>
        </div>

        <div className="top-tools">
          <span className={`sync-chip ${playing ? "playing" : ready ? "ready" : ""}`}><i />{syncLabel}</span>
          <button className="glass-btn restart-btn" onClick={() => void playAll()} disabled={resetting || tracks.length === 0} aria-label="Reiniciar desde el principio">
            <Icon name="restart" /><span>REINICIAR</span>
          </button>
        </div>
      </header>

      {tab === "library" && (
        <section className="screen" aria-label="Biblioteca">
          <div className="lib-head">
            <div><span className="eyebrow">TU MÚSICA</span><h1>Biblioteca</h1></div>
            <button className="glass-btn lib-add" onClick={openLibrary}>AÑADIR CANCIONES</button>
          </div>
          <div className="lib-rows">
            {playlist.length === 0 && <button className="deck-empty" onClick={openLibrary}>Tu repertorio está vacío · toca aquí para añadir canciones</button>}
            {playlist.map((song, index) => (
              <article className={`song-row ${song.id === activeSongId ? "selected" : ""}`} key={song.id}>
                <button className="row-main" onClick={() => { selectSong(song); setTab("live"); }} aria-label={`Abrir ${song.name}`}>
                  <Artwork index={index} />
                  <span><strong>{song.name}</strong><small>{song.id === activeSongId && playing ? "Reproduciendo" : `${song.files.length} pistas`}</small></span>
                </button>
                <button className="deck-remove" onClick={() => removeSong(song.id)} aria-label={`Quitar ${song.name}`}>×</button>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "live" && (
        <section className="screen" aria-label="En vivo">
          <div className="live-status">
            <div className="session-pill"><i className={playing ? "active" : ""} />SESIÓN EN VIVO<b>{click.beats}/4</b></div>
            <div className="loaded-song">
              <Artwork index={Math.max(0, activeIndex)} />
              <span><small>CANCIÓN CARGADA</small><strong>{songName || "Ninguna"}</strong></span>
            </div>
            <button className="glass-btn mixer-link" onClick={() => setTab("mixer")}><Icon name="mixer" />MEZCLADOR</button>
          </div>
          {songDeck}
          <div className="wave-panel" aria-label="Forma de onda">
            <Waveform
              peaks={peaks}
              progress={progress}
              playing={playing}
              getProgress={getProgress}
              loading={peaksLoading && !peaks}
              disabled={tracks.length === 0 || duration <= 0}
              onSeek={(fraction) => void seekTo(fraction)}
            />
            <div className="wave-meta">
              <span>{shortTime(currentTime)}</span>
              <strong><i className={`state-dot ${playing ? "is-playing" : ""}`} />{playing ? "REPRODUCIENDO" : paused ? "EN PAUSA" : "DETENIDO"}</strong>
              <span>-{shortTime(Math.max(0, duration - currentTime))}</span>
            </div>
          </div>
          <div className="mixer-row">
            {mixer}
            {padInline && <aside className="pad-side" aria-label="Pads"><Pads engine={pad} /></aside>}
          </div>
        </section>
      )}

      {tab === "mixer" && (
        <section className="screen" aria-label="Mezclador">
          <div className="lib-head">
            <div><span className="eyebrow">{tracks.length} PISTAS CARGADAS</span><h1>Mezclador</h1></div>
          </div>
          {mixer}
        </section>
      )}

      {statusMessage && <div className="statusline" role="status">{statusMessage}</div>}

      <nav className="tab-bar" aria-label="Navegación principal">
        <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Icon name="library" /><span>Biblioteca</span></button>
        <button className={tab === "live" ? "active" : ""} onClick={() => setTab("live")}><Icon name="play" /><span>Live</span></button>
        <button className={tab === "mixer" ? "active" : ""} onClick={() => setTab("mixer")}><Icon name="mixer" /><span>Mezcla</span></button>
      </nav>

      {showLibrary && (
        <div className="library-layer" aria-label="Biblioteca musical">
          <button className="library-scrim" aria-label="Cerrar biblioteca" onClick={() => setShowLibrary(false)} />
          <aside className="library-panel">
            <div className="library-panel-top">
              <div className="library-panel-heading">
                <div>
                  <span className="eyebrow">CRESCENDO LIVE</span>
                  <strong>Biblioteca</strong>
                </div>
                <button className="library-close" onClick={() => setShowLibrary(false)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                  <span>CERRAR</span>
                </button>
              </div>
              <div className="source-switch" role="tablist" aria-label="Origen de las canciones">
                <button role="tab" aria-selected={source === "local"} className={source === "local" ? "selected" : ""} onClick={() => setSource("local")}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10 18.5h4" /></svg>
                  <span>Este dispositivo</span>
                </button>
                <button role="tab" aria-selected={source === "cloud"} className={source === "cloud" ? "selected" : ""} onClick={() => setSource("cloud")}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h11a4 4 0 0 0 .5-8A6.5 6.5 0 0 0 6 8.2 4.9 4.9 0 0 0 7 18Z" /></svg>
                  <span>Nube Crescendo</span>
                </button>
              </div>
            </div>
            {source === "local"
              ? <div className="library-scroll"><LocalImport onSongLoaded={addSong} /></div>
              : <MegaBrowser onSongLoaded={addSong} />}
          </aside>
        </div>
      )}

      {showClick && <Click metronome={metronome} onClose={() => setShowClick(false)} />}

      {padDrawer && (
        <div className="drawer-backdrop" onClick={() => setPadOpen(false)}>
          <aside className="drawer pad-drawer" onClick={(event) => event.stopPropagation()} aria-label="Pads">
            <div className="drawer-head">
              <h2>Pads</h2>
              <button className="pill-btn" onClick={() => setPadOpen(false)}>CERRAR</button>
            </div>
            <Pads engine={pad} />
          </aside>
        </div>
      )}
    </main>
  );
}
