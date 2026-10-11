import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import MegaBrowser from "./MegaBrowser";
import LocalImport from "./LocalImport";
import Fader from "./Fader";
import Waveform from "./Waveform";
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

function trackLabel(name: string) {
  const value = name.toLowerCase();
  if (/drum|bater|perc|kick|snare|tom|cymbal/.test(value)) return "DRUMS";
  if (/bass|bajo/.test(value)) return "BASS";
  if (/guitar|guitarra|gtr|gu[ií]a?\b/.test(value)) return "GUITAR";
  if (/key|piano|synth|tecla|pad/.test(value)) return "KEYS";
  if (/vocal|voz|choir|coros/.test(value)) return "VOX";
  if (/loop|click|guide|cue/.test(value)) return "GUIDE";
  return "AUDIO";
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

function panLabel(pan: number) {
  if (pan === 0) return "C";
  return pan < 0 ? `${Math.round(Math.abs(pan) * 100)}L` : `${Math.round(pan * 100)}R`;
}

function bpmFromName(name: string): number | null {
  const match = name.match(/(\d{2,3})\s*bpm/i);
  return match ? Number(match[1]) : null;
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
  const [source, setSource] = useState<"local" | "mega">("local");
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
  useEffect(() => {
    const timer = window.setInterval(() => {
      const active = tracksRef.current;
      if (!active.length) {
        setCurrentTime(0);
        setDuration(0);
        return;
      }
      const lead = active[0].audio;
      setCurrentTime(lead.currentTime || 0);
      const known = active.map((track) => track.audio.duration).filter(Number.isFinite);
      setDuration(known.length ? Math.max(...known) : 0);

      if (!playingRef.current || busyRef.current) return;
      if (active.every((track) => track.audio.ended)) {
        void stopAll();
        return;
      }
      for (const track of active.slice(1)) {
        if (!track.audio.ended && Math.abs(track.audio.currentTime - lead.currentTime) > 0.08) {
          try { track.audio.currentTime = lead.currentTime; } catch { /* aún cargando */ }
        }
      }
    }, 150);
    return () => window.clearInterval(timer);
    // stopAll solo usa refs y setters estables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mantiene la pantalla encendida mientras suena (en vivo no debe apagarse).
  useEffect(() => {
    if (!playing || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
        if (cancelled) void lock.release();
      } catch {
        // Sin permiso o batería baja: no es crítico.
      }
    };
    void request();
    const onVisible = () => { if (document.visibilityState === "visible") void request(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [playing]);

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

  // Mantiene la pantalla encendida mientras suena (en vivo no queremos que el celular se duerma).
  useEffect(() => {
    if (!playing || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) void next.release();
        else lock = next;
      } catch {
        // Sin permiso o sin soporte: la reproducción sigue igual.
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
  }, [playing]);

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
  const bpm = bpmFromName(songName);
  const activeIndex = playlist.findIndex((song) => song.id === activeSongId);
  const hasSolo = tracks.some((track) => track.solo);
  const displayNames = trackDisplayNames(tracks.map((track) => track.name));

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 7h14M4 12h10M4 17h6" /></svg>
          </div>
          <div className="brand-text">
            <strong>REDLINE</strong>
            <span>LIVE PERFORMANCE</span>
          </div>
        </div>
        <div className="tempo">
          <strong>{bpm ?? "--"}</strong>
          <span>4/4</span>
        </div>
        <div className="clock">
          <strong>{formatTime(currentTime)}</strong>
          <span>{shortTime(currentTime)} / {shortTime(duration)}</span>
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

        <div className="top-actions">
          <button className="pill-btn" onClick={() => void playAll()} disabled={resetting || tracks.length === 0}>REINICIAR</button>
          <button className="pill-btn primary" onClick={() => setShowLibrary((value) => !value)}>
            {showLibrary ? "CERRAR" : "BIBLIOTECA"}
          </button>
        </div>
      </header>

      <section className="songstrip" aria-label="Repertorio">
        <div className="strip-label">
          <span>REPERTORIO</span>
          <b>{String(playlist.length).padStart(2, "0")} CANCIONES</b>
        </div>
        <div className="strip-scroll">
          {playlist.length === 0 && (
            <button className="strip-empty" onClick={() => setShowLibrary(true)}>
              Tu repertorio está vacío · abre la biblioteca para añadir canciones
            </button>
          )}
          {playlist.map((song, index) => (
            <article className={`song-card ${song.id === activeSongId ? "is-active" : ""}`} key={song.id}>
              <button className="song-art" onClick={() => selectSong(song)} aria-label={`Seleccionar ${song.name}`}>
                <b>{String(index + 1).padStart(2, "0")}</b>
              </button>
              <button className="song-title" onClick={() => selectSong(song)} title={song.name}>
                <strong>{song.name}</strong>
                <span>{song.files.length} pistas</span>
              </button>
              <button className="song-remove" onClick={() => removeSong(song.id)} aria-label={`Quitar ${song.name}`}>×</button>
            </article>
          ))}
        </div>
        <button className="add-song" onClick={() => setShowLibrary(true)} aria-label="Añadir canciones">＋</button>
      </section>

      <section className="wave-panel" aria-label="Forma de onda">
        <Waveform
          peaks={peaks}
          progress={progress}
          loading={peaksLoading && !peaks}
          disabled={tracks.length === 0 || duration <= 0}
          onSeek={(fraction) => void seekTo(fraction)}
        />
        <div className="wave-meta">
          <span className={`state-dot ${playing ? "is-playing" : ""}`} />
          <span>{playing ? "REPRODUCIENDO" : paused ? "EN PAUSA" : "DETENIDO"}</span>
          <em title={songName}>{songName}</em>
          <span className="spacer" />
          <span>{tracks.length} PISTAS</span>
        </div>
      </section>

      <section className="mixer" aria-label="Mezclador">
        {tracks.length === 0 ? (
          <div className="mixer-empty">Selecciona una canción del repertorio para cargar sus pistas.</div>
        ) : (
          <div className="channels">
            {tracks.map((track, index) => {
              const dimmed = track.muted || (hasSolo && !track.solo);
              return (
                <article className={`channel ${dimmed ? "is-dimmed" : ""}`} key={track.id}>
                  <div className="channel-top">
                    <button className={`chip mute ${track.muted ? "active" : ""}`} onClick={() => changeTrack(track.id, { muted: !track.muted })} aria-pressed={track.muted} aria-label={`Silenciar ${track.name}`}>M</button>
                    <button className={`chip solo ${track.solo ? "active" : ""}`} onClick={() => changeTrack(track.id, { solo: !track.solo })} aria-pressed={track.solo} aria-label={`Solo ${track.name}`}>S</button>
                  </div>
                  <label className="pan">
                    <span>PAN <b>{panLabel(track.pan)}</b></span>
                    <input
                      type="range"
                      min="-1"
                      max="1"
                      step="0.01"
                      value={track.pan}
                      aria-label={`Paneo de ${track.name}`}
                      onChange={(event) => changeTrack(track.id, { pan: Number(event.target.value) })}
                      onDoubleClick={() => changeTrack(track.id, { pan: 0 })}
                    />
                  </label>
                  <div className="fader-wrap">
                    <Fader value={track.volume} onChange={(volume) => changeTrack(track.id, { volume })} label={`Volumen de ${track.name}`} dimmed={dimmed} />
                  </div>
                  <div className="channel-name">
                    <span className={`tag tag-${index % 6}`}>{trackLabel(track.name)}</span>
                    <strong title={track.name}>{displayNames[index]}</strong>
                  </div>
                  <button className="channel-remove" onClick={() => removeTrack(track.id)} aria-label={`Eliminar pista ${track.name}`}>×</button>
                </article>
              );
            })}
          </div>
        )}

        <article className="channel master">
          <div className="channel-top"><span className="master-readout">{masterVolume}%</span></div>
          <div className="fader-wrap">
            <Fader value={masterVolume} onChange={setMasterVolume} label="Volumen master" />
          </div>
          <div className="channel-name"><span className="tag tag-master">MASTER</span><strong>Salida</strong></div>
        </article>
      </section>

      <footer className="statusbar">
        <span className="sys"><i className={playing ? "on" : ""} />{statusMessage || "SISTEMA LISTO"}</span>
        <span className="brandline">Redline MultiTracks <b>LIVE</b></span>
        <span className="right">{tracks.length} PISTAS</span>
      </footer>

      {showLibrary && (
        <div className="drawer-backdrop" onClick={() => setShowLibrary(false)}>
          <aside className="drawer" onClick={(event) => event.stopPropagation()} aria-label="Biblioteca">
            <div className="drawer-head">
              <h2>Biblioteca</h2>
              <button className="pill-btn" onClick={() => setShowLibrary(false)}>CERRAR</button>
            </div>
            <div className="source-tabs" role="tablist" aria-label="Origen de las canciones">
              <button role="tab" aria-selected={source === "local"} className={source === "local" ? "is-on" : ""} onClick={() => setSource("local")}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm5 17.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zM7 5v10h10V5z" /></svg>
                Este dispositivo
              </button>
              <button role="tab" aria-selected={source === "mega"} className={source === "mega" ? "is-on" : ""} onClick={() => setSource("mega")}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.4 9 4.5 4.5 0 0 1 17.5 19z" /></svg>
                MEGA
              </button>
            </div>
            {source === "local"
              ? <LocalImport onSongLoaded={addSong} />
              : <MegaBrowser onSongLoaded={addSong} />}
          </aside>
        </div>
      )}
    </main>
  );
}
