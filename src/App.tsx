import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { pistas } from "./format";
import SettingsDrawer, { type DiagnosticsInfo } from "./SettingsDrawer";
import { startFpsWatch, stopFpsWatch } from "./fpsMonitor";
import MarkerEditor from "./MarkerEditor";
import { MARKER_COLORS, dismissHint, hintDismissed, loadMarkers, saveMarkers, type Marker } from "./markers";
import MemoryDialog, { type MemorySong } from "./MemoryDialog";
import "./styles/app.css";
import MegaBrowser from "./MegaBrowser";
import NubeBrowser from "./NubeBrowser";
import { CLOUD_SOURCE } from "./cloudConfig";
import { perfBegin, perfEnd, perfStep } from "./perf";
import ProfileDrawer from "./ProfileDrawer";
import {
  FACTORY_MASTER, PROFILE_LABEL, buildGeneral, buildSong, clearGeneral, clearSongProfile, exportGeneral, factorySetting, importGeneral,
  loadGeneral, loadSongProfile, resolveProfile, saveGeneralProfile, saveSongProfile, songKeyOf, type LiveTrack, type ProfileSource,
} from "./trackProfiles";
import LocalImport from "./LocalImport";
import Fader from "./Fader";
import Pan from "./Pan";
import Waveform from "./Waveform";
import BrandMark from "./BrandMark";
import { FAMILY_COLORS, defaultPan, familyOf, isGuideOrClick } from "./trackFamilies";
import { bindAnalyser, bindMeterElements, setMetersActive, startDemoMeters } from "./meters";
import { useFx } from "./effects";
import ScrubBar from "./ScrubBar";
import { HeaderClock, ElapsedText, RemainingText, getClock, setClock } from "./clock";
import Click from "./Click";
import Splash from "./Splash";
import Pads from "./Pads";
import { PadEngine } from "./padEngine";
import { Metronome } from "./metronome";
import { computePeaks } from "./archive";
import type { TrackStats } from "./analysis.ts";
import { limiterCurve, planNormalization } from "./normalizer.ts";
import { DEFAULT_NORM_MODE, NORM_MODES, NORM_MODE_LABEL, NORM_RAMP_SECONDS, type NormMode } from "./normConfig.ts";
import { applyPan, buildTrackGraph, disposeTrackGraph, type TrackGraph } from "./trackGraph.ts";

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
  /** Bytes que esta canción ocupa en la memoria del dispositivo (descargas de la nube). 0 si sus archivos están en disco. */
  memoryBytes: number;
};

/**
 * Presupuesto de memoria para canciones descargadas (cada una queda en memoria: nada se guarda en el dispositivo).
 * Al añadir una más allá del presupuesto se quitan del repertorio las más antiguas que no estén sonando
 * (volver a añadirlas es un toque en la Nube). Sin esto, un repertorio de varias canciones agota la memoria del celular.
 */
function memoryBudget(): number {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4; // el navegador la reporta redondeada y con tope de 8
  return Math.min(1.5, Math.max(0.6, gb * 0.2)) * 1024 ** 3;
}

type AudioChannel = {
  source: MediaElementAudioSourceNode;
  graph: TrackGraph;
};

const NORM_MODE_KEY = "crescendo-norm-mode-v2";
const OLD_NORMALIZE_KEY = "crescendo-normalize-v1"; // versión anterior: solo encendido/apagado
function loadNormMode(): NormMode {
  try {
    const saved = localStorage.getItem(NORM_MODE_KEY);
    if (saved && (NORM_MODES as string[]).includes(saved)) return saved as NormMode;
    if (localStorage.getItem(OLD_NORMALIZE_KEY) === "0") return "off";
  } catch { /* sin almacenamiento: modo por defecto */ }
  return DEFAULT_NORM_MODE;
}

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

/**
 * Espera a que la pista tenga datos suficientes para sonar sin cortes (readyState >= 3). Si falla o tarda demasiado
 * se da por lista: nunca debe dejar la canción bloqueada para siempre.
 */
function waitCanPlay(audio: HTMLAudioElement, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve) => {
    if (audio.error || audio.readyState >= 3) return resolve();
    const done = () => {
      audio.removeEventListener("canplay", done);
      audio.removeEventListener("canplaythrough", done);
      audio.removeEventListener("error", done);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, timeoutMs);
    audio.addEventListener("canplay", done);
    audio.addEventListener("canplaythrough", done);
    audio.addEventListener("error", done);
  });
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
    pan: defaultPan(file.name), // Click y Guía arrancan a la izquierda
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

type IconName = "metronome" | "restart" | "mixer" | "library" | "play" | "spark";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    metronome: <><path d="M8 20h8l-1.8-16h-4.4L8 20Z" /><path d="m12 7 4 7M10 16h4" /></>,
    restart: <><path d="M4 12a8 8 0 1 0 2.6-5.9" /><path d="M4 4v4.5h4.5" /></>,
    mixer: <><path d="M5 4v16M12 4v16M19 4v16" /><circle cx="5" cy="9" r="2" /><circle cx="12" cy="15" r="2" /><circle cx="19" cy="8" r="2" /></>,
    library: <><path d="M4 4v16M9 4v16" /><path d="m14 5 4-1 3 15-4 1-3-15Z" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />,
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
  const rootRef = useRef<HTMLElement>(null);
  const fillRef = useRef<HTMLElement>(null);
  const family = FAMILY_COLORS[familyOf(track.name)];
  // El medidor se mueve sin pasar por React (ver meters.ts)
  useEffect(() => {
    bindMeterElements(String(track.id), rootRef.current, fillRef.current);
    return () => bindMeterElements(String(track.id), null, null);
  }, [track.id]);
  const style = { "--channel-color": family.color, "--channel-rgb": family.rgb } as React.CSSProperties;
  return (
    <article
      ref={rootRef}
      style={style}
      className={`channel ${track.muted ? "is-muted" : ""} ${track.solo ? "is-soloed" : ""} ${dimmed ? "is-dimmed" : ""}`}
    >
      <div className="channel-head">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <div className="chip-row">
          <button className={`chip mute ${track.muted ? "active" : ""}`} onClick={() => onChange(track.id, { muted: !track.muted })} aria-pressed={track.muted} aria-label={`Silenciar ${track.name}`}>M</button>
          <button className={`chip solo ${track.solo ? "active" : ""}`} onClick={() => onChange(track.id, { solo: !track.solo })} aria-pressed={track.solo} aria-label={`Solo ${track.name}`}>S</button>
        </div>
      </div>
      <div className="fader-wrap">
        <div className="channel-meter" aria-hidden="true"><i ref={fillRef as React.RefObject<HTMLElement>} /></div>
        <Fader value={track.volume} onChange={(volume) => onChange(track.id, { volume })} label={`Volumen de ${track.name}`} dimmed={track.muted || dimmed} />
      </div>
      <Pan value={track.pan} label={`Paneo de ${track.name}`} onChange={(pan) => onChange(track.id, { pan })} />
      <div className="channel-name">
        <strong title={track.name}><i className="family-dot" aria-hidden="true" />{displayName}</strong>
        <small>{track.volume}</small>
      </div>
      <button className="channel-remove" onClick={() => onRemove(track.id)} aria-label={`Eliminar pista ${track.name}`}>×</button>
    </article>
  );
});

type MasterStripProps = { volume: number; onVolume: (value: number) => void; normMode: NormMode; onNormMode: () => void };

/** Canal MASTER: fader, medidor de salida e interruptor de normalización. */
const MasterStrip = memo(function MasterStrip({ volume, onVolume, normMode, onNormMode }: MasterStripProps) {
  const rootRef = useRef<HTMLElement>(null);
  const fillRef = useRef<HTMLElement>(null);
  useEffect(() => {
    bindMeterElements("master", rootRef.current, fillRef.current);
    return () => bindMeterElements("master", null, null);
  }, []);
  const style = { "--channel-color": FAMILY_COLORS.neutral.color, "--channel-rgb": FAMILY_COLORS.neutral.rgb } as React.CSSProperties;
  return (
    <article ref={rootRef} style={style} className="channel master">
      <div className="channel-head">
        MASTER
        <button
          className={`chip norm ${normMode !== "off" ? "active" : ""}`}
          onClick={onNormMode}
          aria-label={`Normalización: ${NORM_MODE_LABEL[normMode]}. Toca para cambiar de modo`}
          title={`Normalización: ${NORM_MODE_LABEL[normMode]} (toca para alternar: Apagado / Suave / Nivelar pistas)`}
        ><span>NORM</span><span>{normMode === "off" ? "OFF" : normMode === "soft" ? "SUAVE" : "NIVEL"}</span></button>
      </div>
      <div className="fader-wrap">
        <div className="channel-meter" aria-hidden="true"><i ref={fillRef as React.RefObject<HTMLElement>} /></div>
        <Fader value={volume} onChange={onVolume} label="Volumen master" />
      </div>
      <div className="master-readout">{volume}%</div>
      <div className="channel-name"><strong>Salida</strong></div>
    </article>
  );
});

const masterDb = (volume: number) => (volume <= 0 ? "−∞" : (20 * Math.log10(volume / 100)).toFixed(1).replace("-", "−"));

/** Tarjeta de salida principal (pestaña Mezcla): nivel en dB del master y medidor de salida. */
const MasterCard = memo(function MasterCard({ volume }: { volume: number }) {
  const fillRef = useRef<HTMLElement>(null);
  useEffect(() => {
    bindMeterElements("master-card", null, fillRef.current, "x");
    return () => bindMeterElements("master-card", null, null);
  }, []);
  return (
    <div className="master-card">
      <span className="master-icon" aria-hidden="true"><Icon name="mixer" /></span>
      <div className="master-card-info"><small>SALIDA PRINCIPAL</small><strong>Master</strong></div>
      <div className="master-db">{masterDb(volume)} <small>dB</small></div>
      <div className="master-led" aria-hidden="true"><i ref={fillRef as React.RefObject<HTMLElement>} /></div>
    </div>
  );
});

/** Marcador en la barra: un toque salta a ese punto; mantenerlo pulsado lo edita. */
const MarkerChip = memo(function MarkerChip({ marker, onJump, onEdit }: { marker: Marker; onJump: () => void; onEdit: () => void }) {
  const timer = useRef(0);
  const longPressed = useRef(false);
  return (
    <button
      className="marker-chip"
      style={{ "--marker-color": marker.color } as React.CSSProperties}
      aria-label={`Ir a ${marker.name}`}
      onPointerDown={() => { longPressed.current = false; timer.current = window.setTimeout(() => { longPressed.current = true; onEdit(); }, 520); }}
      onPointerUp={() => window.clearTimeout(timer.current)}
      onPointerLeave={() => window.clearTimeout(timer.current)}
      onPointerCancel={() => window.clearTimeout(timer.current)}
      onClick={() => { if (!longPressed.current) onJump(); }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <i aria-hidden="true" />{marker.name}
    </button>
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
  // El tiempo y la duración viven en clock.tsx (fuera de React) para que el segundero no repinte el mezclador.
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
  const [expanded, setExpanded] = useState(false);
  const [normMode, setNormMode] = useState<NormMode>(loadNormMode);
  const [statsVersion, setStatsVersion] = useState(0);
  // Preparación de la canción al cargarla (todo lo pesado ocurre aquí, no al pulsar Play).
  const [mediaVersion, setMediaVersion] = useState(0);
  const [queuedPlay, setQueuedPlay] = useState(false);
  // Perfil de arranque de las pistas (fábrica / predeterminado / esta canción).
  const [profileSource, setProfileSource] = useState<ProfileSource>("factory");
  const [profileOpen, setProfileOpen] = useState(false);

  const contextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const channelsRef = useRef<Map<number, AudioChannel>>(new Map());
  const tracksRef = useRef<Track[]>([]);
  const playlistRef = useRef<Song[]>([]);
  const activeSongIdRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const busyRef = useRef(false);
  const masterVolumeRef = useRef(masterVolume);
  const preparedRef = useRef(false);
  // Medidas de nivel/tipo de cada pista (se miden una vez al cargar la canción) y forma de onda ya calculada de cada canción.
  // WeakMap/WeakSet: al quitar una canción, sus archivos (y los datos que retienen) se pueden liberar.
  const statsRef = useRef<WeakMap<File, TrackStats>>(new WeakMap());
  const settledRef = useRef<WeakSet<File>>(new WeakSet());
  const mediaReadyRef = useRef<Set<number>>(new Set());
  const loadTokenRef = useRef(0);
  const songKeyRef = useRef<string | null>(null);
  const peaksCacheRef = useRef<Map<number, Float32Array>>(new Map());
  const normModeRef = useRef(normMode);
  normModeRef.current = normMode;
  // Plan de normalización "fijado": no se recalcula mientras suena (solo al cambiar de modo), para que el volumen nunca cambie a media canción.
  const planRef = useRef<{ mode: NormMode; gains: Map<number, number> } | null>(null);
  const musicBusRef = useRef<GainNode | null>(null);
  // Mezcla (volumen, paneo, mute, solo) de cada canción, para recuperarla al volver a ella. Solo en memoria.
  const mixesRef = useRef<Map<number, Map<string, Pick<Track, "volume" | "pan" | "muted" | "solo">>>>(new Map());

  masterVolumeRef.current = masterVolume;

  function getContext(): AudioContext {
    if (!contextRef.current) {
      const AudioContextClass = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error("Este navegador no admite Web Audio API.");
      // "playback": buffers de salida más grandes = muchas menos interrupciones en celulares modestos (aquí no hay instrumento en vivo).
      const context = new AudioContextClass({ latencyHint: "playback" });
      const master = context.createGain();
      master.gain.value = masterVolumeRef.current / 100;
      master.connect(context.destination);
      // Bus de las pistas musicales (Click y Guía van directo al master): techo suave de pico en -1 dBFS.
      // Es una curva lineal hasta LIMITER_KNEE_DB (no toca nada por debajo) y se curva hasta el techo sin pasarlo nunca.
      const musicBus = context.createGain();
      const limiter = context.createWaveShaper();
      limiter.curve = limiterCurve();
      limiter.oversample = "2x";
      musicBus.connect(limiter);
      limiter.connect(master);
      musicBusRef.current = musicBus;
      const level = context.createAnalyser(); // solo observa: alimenta el medidor del MASTER
      level.fftSize = 512;
      level.smoothingTimeConstant = 0;
      master.connect(level);
      bindAnalyser("master", level);
      bindAnalyser("master-card", level);
      contextRef.current = context;
      masterGainRef.current = master;
    }
    return contextRef.current;
  }

  function applyMix(list: Track[]) {
    const context = contextRef.current;
    if (!context) return;
    const now = context.currentTime;
    masterGainRef.current?.gain.setTargetAtTime(masterVolumeRef.current / 100, now, 0.015);
    const hasSolo = list.some((track) => track.solo);
    // Normalización: ganancia aparte del fader (nodo "norm"); el fader conserva el valor del usuario.
    // Se calcula con todas las pistas medidas y se fija: mientras suena solo se recalcula si el usuario cambia el modo.
    const mode = normModeRef.current;
    if (!planRef.current || planRef.current.mode !== mode || !playingRef.current) {
      const plan = planNormalization(
        list.map((track) => ({ excluded: isGuideOrClick(track.name), stats: statsRef.current.get(track.file) ?? null })),
        mode
      );
      planRef.current = { mode, gains: new Map(list.map((track, index) => [track.id, plan.gains[index]])) };
    }
    list.forEach((track) => {
      const channel = channelsRef.current.get(track.id);
      if (!channel) return;
      const silent = track.muted || (hasSolo && !track.solo);
      channel.graph.fader.gain.setTargetAtTime(silent ? 0 : track.volume / 100, now, 0.015);
      // Click y Guía: ganancia de normalización exactamente 1 siempre.
      const gain = isGuideOrClick(track.name) ? 1 : planRef.current?.gains.get(track.id) ?? 1;
      channel.graph.norm.gain.setTargetAtTime(gain, now, NORM_RAMP_SECONDS / 3);
      applyPan(channel.graph, track.pan, statsRef.current.get(track.file)?.layout ?? "stereo", now);
    });
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
      disposeTrackGraph(channel.graph);
      bindAnalyser(String(track.id), null);
      channelsRef.current.delete(track.id);
    }
  }

  /** Crea (una sola vez por pista) su cadena de audio. Se hace al cargar la canción, no al dar Play. */
  function ensureChannel(track: Track) {
    if (channelsRef.current.has(track.id)) return;
    const context = getContext();
    const source = context.createMediaElementSource(track.audio);
    // Click y Guía: camino directo al master, sin normalización ni limitador.
    const destination = isGuideOrClick(track.name) ? masterGainRef.current : musicBusRef.current;
    const graph = buildTrackGraph(context, source, destination ?? context.destination);
    channelsRef.current.set(track.id, { source, graph });
    bindAnalyser(String(track.id), graph.meter);
  }

  /** Fase de carga: cadena de audio de cada pista y espera a que todas tengan datos para sonar sin cortes. */
  function prepareTracks(list: Track[]) {
    const token = ++loadTokenRef.current;
    perfBegin("carga");
    mediaReadyRef.current = new Set();
    try {
      list.forEach(ensureChannel);
      applyMix(list);
      perfStep("carga", "crear grafo de audio");
    } catch (error) {
      console.error("No se pudo preparar el audio:", error);
    }
    let pending = list.length;
    for (const track of list) {
      void waitCanPlay(track.audio).then(() => {
        if (token !== loadTokenRef.current) return;
        mediaReadyRef.current.add(track.id);
        setMediaVersion((version) => version + 1);
        if (--pending === 0) perfStep("carga", "todas las pistas con datos listos");
      });
    }
  }

  function setPlayState(isPlaying: boolean, isPaused: boolean) {
    playingRef.current = isPlaying;
    setPlaying(isPlaying);
    setPaused(isPaused);
  }

  function disposeActiveTracks() {
    loadTokenRef.current++;
    mediaReadyRef.current = new Set();
    setQueuedPlay(false);
    for (const track of tracksRef.current) releaseTrack(track);
    tracksRef.current = [];
    setTracks([]);
    setPlayState(false, false);
    setClock(0, 0);
    setPeaks(null);
  }

  function loadSong(song: Song) {
    const leaving = activeSongIdRef.current;
    if (leaving !== null && tracksRef.current.length && playlistRef.current.some((item) => item.id === leaving)) {
      mixesRef.current.set(leaving, new Map(tracksRef.current.map((t) => [t.file.name, { volume: t.volume, pan: t.pan, muted: t.muted, solo: t.solo }])));
    }
    disposeActiveTracks();
    const saved = mixesRef.current.get(song.id);
    // Perfil de arranque: canción > predeterminado > fábrica. Lo que el usuario movió en esta sesión (saved) manda sobre todo.
    const songKey = songKeyOf(song.files);
    const display = trackDisplayNames(song.files.map((file) => file.name.replace(/\.[^/.]+$/, "")));
    const resolved = resolveProfile(song.files.map((file, index) => ({ fileName: file.name, displayName: display[index] })), loadSongProfile(songKey), loadGeneral());
    songKeyRef.current = songKey;
    setMarkers(loadMarkers(songKey));
    setMarkerDraft(null);
    setProfileSource(resolved.source);
    if (resolved.masterSource !== "factory") setMasterVolume(resolved.master);
    const nextTracks = song.files.map((file) => ({ ...createTrack(file), ...resolved.settings.get(file.name), ...saved?.get(file.name) }));
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    prepareTracks(nextTracks);
    activeSongIdRef.current = song.id;
    setActiveSongId(song.id);
    setSongName(song.name);
  }

  function activateSong(song: Song) {
    if (busyRef.current) return;
    loadSong(song);
    setStatusMessage(`${song.name} · ${pistas(song.files.length)}`);
  }

  const [memoryPrompt, setMemoryPrompt] = useState<{ name: string; files: File[] } | null>(null);
  const [, setMemoryVersion] = useState(0);

  const addSong = useCallback((name: string, files: File[], options?: { inMemory?: boolean; force?: boolean }) => {
    if (!Array.isArray(files) || files.length === 0) {
      setStatusMessage(`No se pudo añadir ${name}: no contiene pistas válidas.`);
      return;
    }
    const memoryBytes = options?.inMemory ? files.reduce((sum, file) => sum + file.size, 0) : 0;
    // Presupuesto de memoria: si no cabe, no se quita nada en silencio; se pregunta qué quitar (MemoryDialog).
    const used = playlistRef.current.reduce((sum, item) => sum + item.memoryBytes, 0);
    if (!options?.force && memoryBytes > 0 && used + memoryBytes > memoryBudget()) {
      setMemoryPrompt({ name, files });
      setStatusMessage(`Memoria llena: elige qué quitar para añadir ${name}.`);
      return;
    }
    const song: Song = { id: nextId(), name, files, memoryBytes };
    const next = [...playlistRef.current, song];
    playlistRef.current = next;
    setPlaylist(next);
    setStatusMessage(`${name} añadida a la lista (${pistas(files.length)}).`);
    if (activeSongIdRef.current === null) loadSong(song);
    // loadSong solo toca refs y estado de React; no depende de renders previos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const memoryView = (() => {
    if (!memoryPrompt) return null;
    const used = playlistRef.current.reduce((sum, item) => sum + item.memoryBytes, 0);
    const songs: MemorySong[] = playlistRef.current
      .filter((item) => item.memoryBytes > 0)
      .map((item) => ({ id: item.id, name: item.name, tracks: item.files.length, bytes: item.memoryBytes, locked: item.id === activeSongIdRef.current && playingRef.current }));
    return { songs, freeBytes: memoryBudget() - used, bytes: memoryPrompt.files.reduce((sum, file) => sum + file.size, 0) };
  })();

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
    mixesRef.current.delete(songId);
    if (songId !== activeSongIdRef.current) return;
    if (next.length > 0) activateSong(next[0]);
    else {
      disposeActiveTracks();
      activeSongIdRef.current = null;
      setActiveSongId(null);
      setMarkers([]);
      setSongName("Añade una canción");
      setStatusMessage("La lista está vacía.");
    }
  }

  function changeTrack(id: number, changes: Partial<Track>) {
    const next = tracksRef.current.map((track) => (track.id === id ? { ...track, ...changes } : track));
    tracksRef.current = next;
    setTracks(next);
  }

  /** Pistas del mezclador tal como están ahora, con su nombre de tipo (sin el prefijo común de la canción). */
  function liveTracks(): LiveTrack[] {
    const list = tracksRef.current;
    const display = trackDisplayNames(list.map((track) => track.name));
    return list.map((track, index) => ({ fileName: track.file.name, displayName: display[index], volume: track.volume, pan: track.pan, muted: track.muted, solo: track.solo }));
  }

  /** Re-aplica los perfiles guardados a la canción activa (tras importar o restablecer). */
  function applyProfileNow(): ProfileSource {
    const list = tracksRef.current;
    const display = trackDisplayNames(list.map((track) => track.name));
    const key = songKeyRef.current;
    const resolved = resolveProfile(list.map((track, index) => ({ fileName: track.file.name, displayName: display[index] })), key ? loadSongProfile(key) : null, loadGeneral());
    if (activeSongIdRef.current !== null) mixesRef.current.delete(activeSongIdRef.current);
    const next = list.map((track) => ({ ...track, ...resolved.settings.get(track.file.name) }));
    tracksRef.current = next;
    setTracks(next);
    setMasterVolume(resolved.master);
    setProfileSource(resolved.source);
    return resolved.source;
  }

  function saveDefaultProfile(): string {
    if (tracksRef.current.length === 0) return "Carga una canción primero.";
    const ok = saveGeneralProfile(buildGeneral(loadGeneral(), liveTracks(), masterVolumeRef.current));
    const key = songKeyRef.current;
    const hasSongProfile = !!key && !!loadSongProfile(key);
    if (!ok) return "No se pudo guardar en este dispositivo.";
    setProfileSource(hasSongProfile ? "song" : "general");
    return hasSongProfile
      ? "Guardado como predeterminado. Esta canción tiene su propio perfil, que sigue teniendo prioridad."
      : "Guardado como predeterminado para todas las canciones.";
  }

  function saveSongProfileNow(): string {
    const key = songKeyRef.current;
    if (!key || tracksRef.current.length === 0) return "Carga una canción primero.";
    if (!saveSongProfile(key, buildSong(liveTracks(), masterVolumeRef.current))) return "No se pudo guardar en este dispositivo.";
    setProfileSource("song");
    return "Guardado solo para esta canción.";
  }

  function resetProfiles(): string {
    clearGeneral();
    const key = songKeyRef.current;
    if (key) clearSongProfile(key);
    const list = tracksRef.current;
    const display = trackDisplayNames(list.map((track) => track.name));
    if (activeSongIdRef.current !== null) mixesRef.current.delete(activeSongIdRef.current);
    const next = list.map((track, index) => ({ ...track, ...factorySetting(display[index]) }));
    tracksRef.current = next;
    setTracks(next);
    setMasterVolume(FACTORY_MASTER);
    setProfileSource("factory");
    return "Valores de fábrica restablecidos (se borraron el predeterminado y el de esta canción).";
  }

  function exportProfile(): string {
    return exportGeneral(loadGeneral() ?? buildGeneral(null, liveTracks(), masterVolumeRef.current));
  }

  function importProfile(text: string): string {
    const imported = importGeneral(text);
    if (!imported) return "Ese texto no es un perfil válido de Crescendo Live.";
    if (!saveGeneralProfile(imported)) return "No se pudo guardar en este dispositivo.";
    if (tracksRef.current.length > 0) applyProfileNow();
    return "Perfil importado" + (tracksRef.current.length > 0 ? " y aplicado a esta canción." : ". Se aplicará al cargar una canción.");
  }

  async function playAll(force = false) {
    if (busyRef.current) return;
    const currentTracks = [...tracksRef.current];
    if (currentTracks.length === 0) {
      setStatusMessage("Añade una canción y selecciónala primero.");
      return;
    }
    // Aún se está preparando (datos y medición de niveles): queda en espera visible y arranca sola al terminar.
    if (!force && !preparedRef.current) {
      setQueuedPlay(true);
      setStatusMessage("Preparando pistas… empezará sola al terminar.");
      return;
    }
    setQueuedPlay(false);
    busyRef.current = true;
    setResetting(true);
    setPlayState(false, false);
    perfBegin("play");
    try {
      const context = getContext();
      if (context.state !== "running") await context.resume();
      perfStep("play", "AudioContext.resume()");
      // Solo se reinician las pistas que no están ya en cero (tras cargar o detener, ya lo están: no hay nada que esperar).
      const away = currentTracks.filter((track) => track.audio.currentTime > 0.03 || track.audio.ended || track.audio.seeking);
      await Promise.all(away.map((track) => resetAudio(track.audio)));
      perfStep("play", "reiniciar pistas a 0 (seek + espera)");
      currentTracks.forEach(ensureChannel); // normalmente ya existen (se crean al cargar)
      applyMix(tracksRef.current);
      perfStep("play", "grafo de audio y mezcla");
      await Promise.all(currentTracks.map((track) => waitCanPlay(track.audio, 8000)));
      perfStep("play", "datos listos en todas las pistas");
      // Todas las pistas arrancan en la misma vuelta del programa; el corrector de desfase mantiene la alineación.
      const starts = currentTracks.map((track) => track.audio.play());
      await Promise.all(starts);
      perfStep("play", "arranque de las fuentes (play() de todas)");
      perfEnd("play");
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
      await Promise.all(tracksRef.current.map((track) => waitCanPlay(track.audio, 8000))); // listas para que el próximo Play sea inmediato
      setClock(0, getClock().duration);
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
    const duration = getClock().duration;
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
      setClock(target, duration);
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
    // Sin pistas no hay nada sonando: si no, el estado quedaba en "REPRODUCIENDO" con el botón bloqueado y la pantalla encendida.
    if (next.length === 0) setPlayState(false, false);
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
        setClock(0, 0);
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
        setClock(now, getClock().duration);
      }
      const known = active.map((track) => track.audio.duration).filter(Number.isFinite);
      const longest = known.length ? Math.max(...known) : 0;
      if (longest !== lastDurationRef.current) {
        lastDurationRef.current = longest;
        setClock(getClock().time, longest);
      }

      if (!playingRef.current || busyRef.current) return;
      if (active.every((track) => track.audio.ended)) {
        void stopAll();
        return;
      }
      if (lead.ended) return;
      // Si alguna pista está cargando/buscando, no se corrige nada: mover pistas en ese momento solo causa más cortes.
      if (active.some((track) => track.audio.seeking || (!track.audio.ended && track.audio.readyState < 3))) return;
      for (const track of active) {
        if (track.audio === lead) continue;
        if (!track.audio.ended && Math.abs(track.audio.currentTime - lead.currentTime) > 0.12) {
          try { track.audio.currentTime = lead.currentTime; } catch { /* aún cargando */ }
        }
      }
    }, 150);
    return () => window.clearInterval(timer);
    // stopAll solo usa refs y setters estables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Los avisos se ocultan solos.
  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  useWakeLock(playing || click.running || padState.playing);
  useEffect(() => { setMetersActive(playing); }, [playing]);
  const [fx, setFx] = useFx();
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [markerDraft, setMarkerDraft] = useState<{ marker: Marker; isNew: boolean } | null>(null);
  const [hintShown, setHintShown] = useState(() => !hintDismissed());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slowPrompt, setSlowPrompt] = useState(false);
  // Fotogramas lentos sostenidos (< 40 fps durante 5 s) con efectos Completos: se propone pasar a Reducidos (nunca se cambia en silencio).
  const slowAsked = useRef(false);
  useEffect(() => {
    if (!playing) { stopFpsWatch(); return; }
    startFpsWatch(fx === "full" && !slowAsked.current ? () => { slowAsked.current = true; setSlowPrompt(true); } : null);
    return stopFpsWatch;
  }, [playing, fx]);

  // Solo en desarrollo: inspección de las ganancias reales del grafo (para comprobar la normalización).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__mix = () => tracksRef.current.map((track) => {
      const graph = channelsRef.current.get(track.id)?.graph;
      return { name: track.name, norm: graph?.norm.gain.value ?? NaN, fader: graph?.fader.gain.value ?? NaN, pan: graph ? graph.taps.map((tap) => +tap.gain.value.toFixed(3)) : [] };
    });
  }, []);

  // Solo en desarrollo: canciones sintéticas para ver y medir la interfaz (window.__demo("Nombre", 13)).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__demo = async (title = "Todo de nuevo", count = 13, fakeMB = 0) => {
      const { makeDemoSong } = await import("./devDemo");
      addSong(title, makeDemoSong(title, count, 60, fakeMB), { inMemory: fakeMB > 0 });
    };
  }, [addSong]);

  // Solo en desarrollo, con ?demo en la dirección: canciones falsas (la primera con 10 pistas), medidores animados y una pista en mute,
  // para revisar el diseño con todo visible. Todo este bloque se elimina del APK de producción (import.meta.env.DEV).
  useEffect(() => {
    if (!import.meta.env.DEV || !new URLSearchParams(window.location.search).has("demo")) return;
    let cancelled = false;
    void (async () => {
      const { makeDemoSong, DEMO_TRACK_NAMES } = await import("./devDemo");
      if (cancelled) return;
      addSong("Todo de nuevo", makeDemoSong("Todo de nuevo", 10, 30, 0, DEMO_TRACK_NAMES));
      addSong("Despertar", makeDemoSong("Despertar", 9, 5, 0, DEMO_TRACK_NAMES));
      addSong("Sin miedo", makeDemoSong("Sin miedo", 8, 5, 0, DEMO_TRACK_NAMES));
      window.setTimeout(() => {
        document.querySelectorAll<HTMLElement>(".channel").forEach((channel, index) => { channel.dataset.demoSeed = String(index); });
        const guitar = tracksRef.current.find((track) => /guitarra/i.test(track.name));
        if (guitar) changeTrack(guitar.id, { muted: true });
        startDemoMeters();
      }, 900);
    })();
    return () => { cancelled = true; };
    // changeTrack solo usa refs y setters estables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSong]);

  // Un solo AudioContext para toda la sesión; se despierta con el primer gesto del usuario (los celulares lo dejan dormido hasta entonces)
  // y de nuevo si el sistema lo vuelve a suspender.
  useEffect(() => {
    const wake = () => {
      const context = contextRef.current;
      if (context && context.state === "suspended") void context.resume();
    };
    window.addEventListener("pointerdown", wake, true);
    window.addEventListener("keydown", wake, true);
    return () => {
      window.removeEventListener("pointerdown", wake, true);
      window.removeEventListener("keydown", wake, true);
    };
  }, []);

  useEffect(() => () => metronome.dispose(), [metronome]);
  useEffect(() => () => pad.dispose(), [pad]);

  useEffect(() => {
    applyMix(tracks);
    // applyMix lee solo refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, masterVolume, normMode, statsVersion]);

  useEffect(() => {
    try { localStorage.setItem(NORM_MODE_KEY, normMode); } catch { /* sin almacenamiento */ }
  }, [normMode]);

  // Forma de onda y análisis de nivel de la canción activa (una vez por canción; al volver a ella ya está hecho).
  useEffect(() => {
    const song = playlistRef.current.find((item) => item.id === activeSongId);
    if (!song) {
      setPeaksLoading(false); // sin canción activa no hay nada que analizar (evita dejar el aviso "Analizando…" pegado)
      return;
    }
    const cached = peaksCacheRef.current.get(song.id);
    if (cached && song.files.every((file) => statsRef.current.has(file))) {
      setPeaks(cached);
      setPeaksLoading(false);
      return;
    }
    let cancelled = false;
    setPeaksLoading(true);
    void computePeaks(song.files, PEAK_BUCKETS, {
      isCancelled: () => cancelled,
      shouldWait: () => playingRef.current,
      onProgress: (partial) => { if (!cancelled) setPeaks(partial); },
      onStats: (file, stats) => { statsRef.current.set(file, stats); },
      onSettled: (file) => {
        settledRef.current.add(file);
        if (!cancelled) setStatsVersion((version) => version + 1);
      },
      excludeFromPeaks: (file) => isGuideOrClick(file.name.replace(/\.[^/.]+$/, "")),
    })
      .then((result) => {
        if (cancelled || !result) return;
        peaksCacheRef.current.set(song.id, result);
        setPeaks(result);
      })
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

  const activeIndex = playlist.findIndex((song) => song.id === activeSongId);
  const hasSolo = tracks.some((track) => track.solo);
  const displayNames = trackDisplayNames(tracks.map((track) => track.name));
  // Manejadores estables (siempre llaman a la versión más reciente) para que los canales con memo no se repinten sin motivo.
  const trackActions = useRef({ changeTrack, removeTrack });
  trackActions.current = { changeTrack, removeTrack };
  const onTrackChange = useCallback((id: number, changes: Partial<Track>) => trackActions.current.changeTrack(id, changes), []);
  const onTrackRemove = useCallback((id: number) => trackActions.current.removeTrack(id), []);
  // Preparada = todas las pistas con datos listos y su nivel/tipo medidos (o intentados).
  const readyCount = useMemo(
    () => tracks.filter((track) => mediaReadyRef.current.has(track.id) && settledRef.current.has(track.file)).length,
    // mediaVersion y statsVersion avisan de los cambios en las referencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, mediaVersion, statsVersion]
  );
  const preparing = tracks.length > 0 && readyCount < tracks.length;
  preparedRef.current = tracks.length > 0 && !preparing;
  const ready = tracks.length > 0 && !resetting && !preparing;
  const syncLabel = preparing ? `Preparando pistas… ${readyCount}/${tracks.length}` : resetting ? "Sincronizando…" : playing ? "En vivo" : ready ? "Pistas sincronizadas" : "Sin canción";

  // Si el usuario pulsó Play mientras se preparaba, arranca en cuanto todo está listo.
  useEffect(() => {
    if (queuedPlay && !preparing) void playAll();
    // playAll solo usa refs y setters estables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedPlay, preparing]);

  function commitMarkers(next: Marker[]) {
    const sorted = [...next].sort((a, b) => a.position - b.position);
    setMarkers(sorted);
    if (songKeyRef.current) saveMarkers(songKeyRef.current, sorted);
  }

  function addMarkerAt(fraction: number) {
    if (!getClock().duration) return;
    const color = MARKER_COLORS[markers.length % MARKER_COLORS.length];
    setMarkerDraft({ marker: { id: Date.now(), name: "Coro", position: fraction, color }, isNew: true });
  }

  function saveMarker(marker: Marker) {
    commitMarkers([...markers.filter((item) => item.id !== marker.id), marker]);
    setMarkerDraft(null);
    if (hintShown) { dismissHint(); setHintShown(false); }
  }

  function getDiagnostics(): DiagnosticsInfo {
    const context = contextRef.current;
    return {
      audio: context ? { state: context.state, sampleRate: context.sampleRate, baseLatency: context.baseLatency ?? 0, outputLatency: context.outputLatency ?? 0 } : null,
      songs: playlistRef.current.length,
      tracks: tracksRef.current.length,
      memoryUsedBytes: playlistRef.current.reduce((sum, item) => sum + item.memoryBytes, 0),
      memoryBudgetBytes: memoryBudget(),
      playing: playingRef.current,
    };
  }

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
            <span><strong>{song.name}</strong><small>{pistas(song.files.length)}</small></span>
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
            dimmed={hasSolo && !track.solo && !track.muted}
            onChange={onTrackChange}
            onRemove={onTrackRemove}
          />
        ))}
        <MasterStrip volume={masterVolume} onVolume={setMasterVolume} normMode={normMode} onNormMode={() => setNormMode((mode) => NORM_MODES[(NORM_MODES.indexOf(mode) + 1) % NORM_MODES.length])} />
      </div>
    </div>
  );

  return (
    <main className="app">
      {showSplash && <Splash onDone={() => setShowSplash(false)} />}
      <header className="topbar">
        <div className="brand">
          <BrandMark className="brand-logo" />
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
          <HeaderClock />
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
            {resetting || preparing ? <span className="spinner" /> : playing
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
          <span className={`sync-chip ${playing ? "playing" : ready ? "ready" : ""}`} role="status" title={syncLabel} aria-label={syncLabel}><i /><b className="sync-label">{syncLabel}</b></span>
          <button className="glass-btn profile-top" onClick={() => setProfileOpen(true)} aria-label="Perfil de pistas">PERFIL</button>
          <button className="glass-btn square settings-btn" onClick={() => setSettingsOpen(true)} aria-label="Ajustes" title="Ajustes">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></svg>
          </button>
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
                  <span><strong>{song.name}</strong><small>{song.id === activeSongId && playing ? "Reproduciendo" : pistas(song.files.length)}</small></span>
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
            <button className="loaded-song" onClick={() => tracks.length > 0 && setExpanded(true)} aria-label="Abrir el reproductor ampliado">
              <Artwork index={Math.max(0, activeIndex)} />
              <span><small>CANCIÓN CARGADA · PERFIL {PROFILE_LABEL[profileSource].toUpperCase()}</small><strong>{songName || "Ninguna"}</strong></span>
            </button>
            <button className="glass-btn profile-chip" onClick={() => setProfileOpen(true)} aria-label="Perfil de pistas">PERFIL</button>
          </div>
          {songDeck}
          <div className="wave-panel" aria-label="Forma de onda">
            <Waveform
              peaks={peaks}
              playing={playing}
              getProgress={getProgress}
              loading={peaksLoading && !peaks}
              disabled={tracks.length === 0}
              onSeek={(fraction) => void seekTo(fraction)}
              onLongPress={addMarkerAt}
            />
            {markers.length > 0 && (
              <div className="wave-marks" aria-hidden="true">
                {markers.map((marker) => <i key={marker.id} style={{ left: `${marker.position * 100}%`, background: marker.color }} />)}
              </div>
            )}
            <div className="wave-meta">
              <ElapsedText />
              {markers.length === 0 && hintShown && tracks.length > 0 ? (
                <span className="marker-hint">
                  <span>Mantén pulsada la onda para añadir marcadores</span>
                  <button aria-label="No volver a mostrar" onClick={() => { dismissHint(); setHintShown(false); }}>×</button>
                </span>
              ) : (
                <strong><i className={`state-dot ${playing ? "is-playing" : ""}`} />{playing ? "REPRODUCIENDO" : paused ? "EN PAUSA" : "DETENIDO"}</strong>
              )}
              <RemainingText />
            </div>
          </div>
          {markers.length > 0 && (
            <div className="marker-bar" role="toolbar" aria-label="Marcadores de sección">
              {markers.map((marker) => (
                <MarkerChip key={marker.id} marker={marker} onJump={() => void seekTo(marker.position)} onEdit={() => setMarkerDraft({ marker, isNew: false })} />
              ))}
            </div>
          )}
          <div className="mixer-row">
            {mixer}
            {padInline && <aside className="pad-side" aria-label="Pads"><Pads engine={pad} /></aside>}
          </div>
        </section>
      )}

      {tab === "mixer" && (
        <section className="screen" aria-label="Mezclador">
          <div className="lib-head">
            <div><span className="eyebrow">{pistas(tracks.length).toUpperCase()} {tracks.length === 1 ? "CARGADA" : "CARGADAS"}</span><h1>Mezclador</h1></div>
            <button className="glass-btn profile-chip" onClick={() => setProfileOpen(true)} aria-label="Perfil de pistas">PERFIL · {PROFILE_LABEL[profileSource].toUpperCase()}</button>
            <MasterCard volume={masterVolume} />
          </div>
          {mixer}
        </section>
      )}

      {preparing && (
        <div className="prepare-bar" role="status" aria-live="polite">
          <div className="prepare-copy">
            <span className="eyebrow">PREPARANDO MULTITRACK</span>
            <strong>Preparando pistas {readyCount}/{tracks.length}</strong>
            <div className="load-progress" style={{ "--pct": tracks.length ? readyCount / tracks.length : 0 } as React.CSSProperties}><span /></div>
          </div>
          <button className="pill-btn" onClick={() => { setQueuedPlay(false); void playAll(true); }} disabled={resetting}>TOCAR YA</button>
        </div>
      )}
      {statusMessage && !memoryPrompt && !markerDraft && (
        <div className="app-toast" role="status" aria-live="polite" key={statusMessage}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /></svg>
          <span>{statusMessage}</span>
        </div>
      )}

      {tab !== "live" && tracks.length > 0 && (
        <div className="mini-player">
          <button className="mini-main" onClick={() => setExpanded(true)} aria-label="Abrir el reproductor ampliado">
            <Artwork index={Math.max(0, activeIndex)} />
            <span className="mini-copy"><strong>{songName}</strong><small>{playing ? "Reproduciendo" : paused ? "En pausa" : "Detenido"} · {pistas(tracks.length)}</small></span>
            <span className={`mini-wave ${playing ? "is-live" : ""}`} aria-hidden="true"><i /><i /><i /><i /></span>
          </button>
          <button className={`play-btn ${playing ? "is-playing" : ""}`} onClick={togglePlay} disabled={resetting} aria-label={playing ? "Pausar" : "Reproducir"}>
            {playing
              ? <svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
              : <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
          </button>
        </div>
      )}

      <nav className="tab-bar" aria-label="Navegación principal" style={{ "--tab-i": tab === "library" ? 0 : tab === "live" ? 1 : 2 } as React.CSSProperties}>
        <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Icon name="library" /><span>Biblioteca</span></button>
        <button className={tab === "live" ? "active" : ""} onClick={() => setTab("live")}><Icon name="play" /><span>Live</span></button>
        <button className={tab === "mixer" ? "active" : ""} onClick={() => setTab("mixer")}><Icon name="mixer" /><span>Mezcla</span></button>
      </nav>

      {expanded && (
        <div className="player-overlay" role="dialog" aria-label="Reproductor ampliado">
          <div className="player-head">
            <button className="glass-btn square" onClick={() => setExpanded(false)} aria-label="Cerrar el reproductor"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></button>
            <span className="eyebrow">{playing ? "REPRODUCIENDO" : paused ? "EN PAUSA" : "DETENIDO"}</span>
            <span className="player-head-spacer" />
          </div>
          <div className="player-art"><Artwork index={Math.max(0, activeIndex)} /></div>
          <div className="player-body">
            <div className="player-copy">
              <h2>{songName}</h2>
              <p>{pistas(tracks.length)}</p>
            </div>
            <div className="player-progress">
              <ScrubBar playing={playing} getProgress={getProgress} disabled={tracks.length === 0} onSeek={(fraction) => void seekTo(fraction)} />
              <div className="player-times"><ElapsedText /><RemainingText /></div>
            </div>
            <div className="player-controls">
              <button className="icon-btn" onClick={() => stepSong(-1)} disabled={resetting || activeIndex <= 0} aria-label="Canción anterior"><svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg></button>
              <button className={`play-btn big ${playing ? "is-playing" : ""}`} onClick={togglePlay} disabled={resetting || tracks.length === 0} aria-label={playing ? "Pausar" : "Reproducir"}>
                {resetting || preparing ? <span className="spinner" /> : playing
                  ? <svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
                  : <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
              </button>
              <button className="icon-btn" onClick={() => stepSong(1)} disabled={resetting || activeIndex < 0 || activeIndex >= playlist.length - 1} aria-label="Canción siguiente"><svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg></button>
            </div>
            <button className="glass-btn open-mixer" onClick={() => { setExpanded(false); setTab("mixer"); }}><Icon name="mixer" />ABRIR MEZCLADOR</button>
          </div>
        </div>
      )}

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
              : CLOUD_SOURCE === "mega" ? <MegaBrowser onSongLoaded={addSong} /> : <NubeBrowser onSongLoaded={addSong} />}
          </aside>
        </div>
      )}

      {memoryPrompt && memoryView && (
        <MemoryDialog
          incoming={{ name: memoryPrompt.name, tracks: memoryPrompt.files.length, bytes: memoryView.bytes }}
          songs={memoryView.songs}
          freeBytes={memoryView.freeBytes}
          onRemove={(id) => { removeSong(id); setMemoryVersion((version) => version + 1); }}
          onConfirm={() => { addSong(memoryPrompt.name, memoryPrompt.files, { inMemory: true, force: true }); setMemoryPrompt(null); }}
          onCancel={() => { setMemoryPrompt(null); setStatusMessage("Canción no añadida."); }}
        />
      )}

      {markerDraft && (
        <MarkerEditor
          marker={markerDraft.marker}
          isNew={markerDraft.isNew}
          duration={getClock().duration}
          onSave={saveMarker}
          onDelete={() => { commitMarkers(markers.filter((item) => item.id !== markerDraft.marker.id)); setMarkerDraft(null); }}
          onClose={() => setMarkerDraft(null)}
        />
      )}

      {settingsOpen && (
        <SettingsDrawer
          normMode={normMode}
          onNormMode={setNormMode}
          onOpenProfiles={() => { setSettingsOpen(false); setProfileOpen(true); }}
          getDiagnostics={getDiagnostics}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {slowPrompt && (
        <div className="slow-prompt" role="alertdialog" aria-label="Fotogramas lentos">
          <span>La pantalla va lenta. ¿Pasar a efectos reducidos?</span>
          <button className="pill-btn" onClick={() => setSlowPrompt(false)}>NO, GRACIAS</button>
          <button className="pill-btn primary" onClick={() => { setFx("reduced"); setSlowPrompt(false); setStatusMessage("Efectos visuales: Reducidos"); }}>REDUCIR</button>
        </div>
      )}

      {showClick && <Click metronome={metronome} onClose={() => setShowClick(false)} />}

      {profileOpen && (
        <ProfileDrawer
          source={profileSource}
          hasSong={tracks.length > 0}
          onSaveDefault={saveDefaultProfile}
          onSaveSong={saveSongProfileNow}
          onReset={resetProfiles}
          onExport={exportProfile}
          onImport={importProfile}
          onClose={() => setProfileOpen(false)}
        />
      )}

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
