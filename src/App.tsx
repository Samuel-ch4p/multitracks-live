import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { pistas } from "./format";
import SettingsScreen, { type DiagnosticsInfo } from "./SettingsScreen";
import { startFpsWatch, stopFpsWatch } from "./fpsMonitor";
import MarkerEditor from "./MarkerEditor";
import { MARKER_COLORS, dismissHint, hintDismissed, loadMarkers, saveMarkers, type Marker } from "./markers";
import { LoadCard } from "./CloudParts";
import { planWindow, memoryBudgetBytes, type PlanSong } from "./memoryPlan";
import { MEMORIA } from "./cloud/config";
import { fetchSongFiles, type CatalogSong, type SongProgress } from "./cloud/cloudSource";
import { CloudError, friendlyCloudMessage } from "./cloud/errors";
import { signOut } from "./cloud/auth";
import { getPreload, subscribePreload } from "./preload";
import "./styles/app.css";
import "./styles/nav.css";
import "./styles/mixer.css";
import "./styles/library.css";
import "./styles/pads.css";
import "./styles/setlists.css";
import "./styles/click.css";
import "./styles/dialogs.css";
import { startModalGuard } from "./modalGuard";
import ChannelScroll from "./ChannelScroll";
import SetlistScreen from "./SetlistScreen";
import SavedSetlists from "./SavedSetlists";
import { defaultSetlistName, saveSession, type SavedSession, type SavedSong, type SongConfig, type SongRef } from "./setlistStore";
import { useUserId } from "./AuthGate";
import { setAudioActive } from "./inactivity";
import { useSearchMode } from "./searchMode";
import NubeBrowser from "./NubeBrowser";
import { perfBegin, perfEnd, perfStep } from "./perf";
import { songKeyOf } from "./trackProfiles";
import { getStoredMaster } from "./account";
import LocalImport from "./LocalImport";
import Fader from "./Fader";
import Pan from "./Pan";
import Waveform from "./Waveform";
import BrandMark from "./BrandMark";
import { FAMILY_COLORS, defaultPan, familyOf, isGuideOrClick } from "./trackFamilies";
import { bindAnalyser, bindMeterElements, setMetersActive, startDemoMeters } from "./meters";
import { useFx } from "./effects";
import ScrubBar from "./ScrubBar";
import { HeaderClock, ElapsedText, RemainingText, getClock, setClock, useProgress } from "./clock";
import Click, { ClickPulse } from "./Click";
import Splash from "./Splash";
import Pads from "./Pads";
import { PadEngine, type PadSettings } from "./padEngine";
import { Metronome, type ClickSettings } from "./metronome";
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
  /** Tamaño en la nube (catálogo): sirve para planear la ventana de memoria antes de descargar. 0 en las de «Este dispositivo». */
  sizeBytes: number;
  /** Clave estable de la canción (marcadores); se calcula al cargarla y se conserva al liberarla. */
  songKey?: string;
  /** Tono y BPM que informa el catálogo de la nube (si no vienen, se leen del nombre). */
  tone?: string | null;
  bpm?: number | null;
  /** Referencia a la canción de la nube (para guardar setlists). Las de "Este dispositivo" no la tienen. */
  ref?: SongRef;
  /** Configuración guardada con el culto del que viene la canción (mezcla, marcadores, click y pad). */
  config?: SongConfig;
};

/**
 * Presupuesto para las canciones cargadas en RAM (ver MEMORIA en cloud/config.ts y memoryPlan.ts). El setlist admite cualquier número de
 * canciones: solo se mantienen cargadas la activa, la anterior y las siguientes que quepan. En desarrollo, ?budgetMB=400 simula un celular chico.
 */
function memoryBudget(): number {
  const dev = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get("budgetMB")) : 0;
  return memoryBudgetBytes((navigator as Navigator & { deviceMemory?: number }).deviceMemory, MEMORIA, dev || undefined);
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

const HOLD_MS = 450;
/** Tiempo para deshacer al quitar una pista con la ×. */
const UNDO_MS = 5000;
/**
 * Guardia contra toques accidentales en acciones que cortan el canto (Detener, Reiniciar): mientras `guarded` (suena la canción) hay que
 * mantener pulsado HOLD_MS (la barra del botón se va llenando); un toque corto solo avisa. Con `guarded` apagado actúa con un toque.
 * El teclado (Enter/Espacio) y los lectores de pantalla siguen activando con una sola pulsación.
 */
function useHoldToConfirm(action: () => void, guarded: boolean, onShortTap: () => void) {
  const [holding, setHolding] = useState(false);
  const timer = useRef(0);
  const fired = useRef(false);
  const actionRef = useRef(action);
  useEffect(() => { actionRef.current = action; });
  const cancel = useCallback(() => { window.clearTimeout(timer.current); timer.current = 0; setHolding(false); }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Si la canción deja de sonar a mitad de la pulsación, la cuenta se anula sin tocar el estado desde un efecto.
  useEffect(() => { if (!guarded) { window.clearTimeout(timer.current); timer.current = 0; } }, [guarded]);
  return {
    className: `hold-btn${guarded ? " is-armed" : ""}${holding && guarded ? " is-holding" : ""}`,
    onPointerDown: () => {
      if (!guarded) return;
      fired.current = false;
      setHolding(true);
      timer.current = window.setTimeout(() => { fired.current = true; timer.current = 0; setHolding(false); actionRef.current(); }, HOLD_MS);
    },
    onPointerUp: () => { const early = timer.current !== 0; cancel(); if (guarded && early && !fired.current) onShortTap(); },
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: { preventDefault: () => void }) => { if (guarded) event.preventDefault(); },
    onClick: (event: { detail: number }) => { if (!guarded || event.detail === 0) actionRef.current(); },
  };
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

type IconName = "metronome" | "restart" | "mixer" | "library" | "play" | "spark" | "setlist" | "settings";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    metronome: <><path d="M8 20h8l-1.8-16h-4.4L8 20Z" /><path d="m12 7 4 7M10 16h4" /></>,
    restart: <><path d="M4 12a8 8 0 1 0 2.6-5.9" /><path d="M4 4v4.5h4.5" /></>,
    mixer: <><path d="M5 4v16M12 4v16M19 4v16" /><circle cx="5" cy="9" r="2" /><circle cx="12" cy="15" r="2" /><circle cx="19" cy="8" r="2" /></>,
    library: <><path d="M4 4v16M9 4v16" /><path d="m14 5 4-1 3 15-4 1-3-15Z" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    setlist: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></>,
    spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>;
}

type ChannelStripProps = {
  track: Track;
  displayName: string;
  dimmed: boolean;
  onChange: (id: number, changes: Partial<Track>) => void;
  onRemove: (id: number) => void;
};

/** Un canal del mezclador. Con memo, mover un fader solo vuelve a pintar ese canal (y no los demás ni la pantalla entera). */
const ChannelStrip = memo(function ChannelStrip({ track, displayName, dimmed, onChange, onRemove }: ChannelStripProps) {
  const rootRef = useRef<HTMLElement>(null);
  const fillRef = useRef<HTMLElement>(null);
  const family = FAMILY_COLORS[familyOf(track.name)];
  // El medidor se mueve sin pasar por React (ver meters.ts)
  useEffect(() => {
    bindMeterElements(String(track.id), rootRef.current, fillRef.current);
    return () => bindMeterElements(String(track.id), null, null);
  }, [track.id]);
  const style = { "--channel-color": family.color, "--channel-rgb": family.rgb, "--c-canal": family.fill } as React.CSSProperties;
  return (
    <article
      ref={rootRef}
      style={style}
      className={`channel ${track.muted ? "is-muted" : ""} ${track.solo ? "is-soloed" : ""} ${dimmed ? "is-dimmed" : ""}`}
    >
      <div className="channel-head">
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

const masterDb = (volume: number) => (volume <= 0 ? "−∞" : (20 * Math.log10(volume / 100)).toFixed(1).replace("-", "−"));

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
      <div className="master-readout"><strong>{masterDb(volume)}</strong><small>dB</small></div>
      <div className="channel-name"><strong>MASTER</strong><small>{volume}</small></div>
    </article>
  );
});

/** Nombre de la sección en curso: el del último marcador ya pasado. No se muestra si no hay marcadores o aún no se llegó al primero. */
function SectionName({ markers }: { markers: Marker[] }) {
  const progress = useProgress();
  let current: Marker | null = null;
  for (const marker of markers) if (marker.position <= progress && (!current || marker.position >= current.position)) current = marker;
  if (!current) return null;
  return <span className="wave-section" style={{ "--marker-color": current.color } as React.CSSProperties}><i aria-hidden="true" />{current.name}</span>;
}

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
  // Última pista quitada con la ×: se conserva UNDO_MS para poder deshacer (ver removeTrack / undoRemoval).
  const [removedName, setRemovedName] = useState<string | null>(null);
  const pendingRemoval = useRef<{ track: Track; index: number; timer: number } | null>(null);
  const [songName, setSongName] = useState("Añade una canción");
  // El tiempo y la duración viven en clock.tsx (fuera de React) para que el segundero no repinte el mezclador.
  const [masterVolume, setMasterVolume] = useState(85);
  const [source, setSource] = useState<"local" | "cloud">("local");
  // Las pruebas automáticas (navegador sin cabeza) se saltan la pantalla de inicio.
  const [showSplash, setShowSplash] = useState(() => !navigator.webdriver);
  const [tab, setTab] = useState<"library" | "setlist" | "mixer" | "settings">("mixer");
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
  // Ajustes de click y pad con los que se usó cada canción (se guardan al salir de ella y se aplican al volver). Solo en memoria.
  const extrasRef = useRef<Map<number, { click?: Partial<ClickSettings>; pad?: Partial<PadSettings> }>>(new Map());

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
    finalizePendingRemoval();
    for (const track of tracksRef.current) releaseTrack(track);
    tracksRef.current = [];
    setTracks([]);
    setPlayState(false, false);
    setClock(0, 0);
    setPeaks(null);
  }

  /** Ajustes de click y pad tal como están ahora. */
  function currentExtras(): { click: ClickSettings; pad: PadSettings } {
    const { bpm, beats, subdivision, accent, sound, output, volume } = metronome.getState();
    const padNow = pad.getState();
    return { click: { bpm, beats, subdivision, accent, sound, output, volume }, pad: { note: padNow.note, sharp: padNow.sharp, minor: padNow.minor, volume: padNow.volume } };
  }

  function loadSong(song: Song) {
    const leaving = activeSongIdRef.current;
    if (leaving !== null && tracksRef.current.length && playlistRef.current.some((item) => item.id === leaving)) {
      mixesRef.current.set(leaving, new Map(tracksRef.current.map((t) => [t.file.name, { volume: t.volume, pan: t.pan, muted: t.muted, solo: t.solo }])));
    }
    if (leaving !== null && playlistRef.current.some((item) => item.id === leaving)) extrasRef.current.set(leaving, currentExtras());
    disposeActiveTracks();
    const saved = mixesRef.current.get(song.id);
    const extras = extrasRef.current.get(song.id);
    if (extras?.click) metronome.set(extras.click);
    if (extras?.pad && !pad.getState().playing) pad.set(extras.pad); // con el pad sonando no se cambia el acorde por sorpresa
    // Cada pista arranca con los valores de fábrica (volumen 80, Click y Guía a la izquierda); lo que el usuario movió en esta sesión
    // o la mezcla guardada con el culto (saved) manda. Ya no hay perfiles de pistas predeterminados.
    const songKey = songKeyOf(song.files);
    songKeyRef.current = songKey;
    setMarkers(loadMarkers(songKey));
    setMarkerDraft(null);
    const storedMaster = getStoredMaster(); // ajuste "Volumen maestro predeterminado" de Ajustes (si el usuario lo cambió)
    if (storedMaster !== null) setMasterVolume(storedMaster);
    const nextTracks = song.files.map((file) => ({ ...createTrack(file), ...saved?.get(file.name) }));
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    prepareTracks(nextTracks);
    activeSongIdRef.current = song.id;
    setActiveSongId(song.id);
    setSongName(song.name);
  }

  function activateSong(song: Song) {
    if (busyRef.current) return;
    // Una canción de la nube que ya no está cargada (o aún no): queda activa y la ventana la descarga (con aviso de progreso).
    if (song.files.length === 0 && song.ref) { setActiveUnloaded(song); return; }
    loadSong(song);
    setStatusMessage(`${song.name} · ${pistas(song.files.length)}`);
  }

  // ---- Ventana de canciones cargadas (memoryPlan.ts): el setlist son referencias; solo algunas están cargadas en RAM ----
  const [loadInfo, setLoadInfo] = useState<{ id: number; percent: number | null } | null>(null);
  const [fg, setFg] = useState<{ id: number; stage: "download" | "extract"; percent: number | null; detail: string; fileName: string; error: string | null; supportReason?: string } | null>(null);
  const [loaderTick, setLoaderTick] = useState(0);
  const preloadOn = useSyncExternalStore(subscribePreload, getPreload);
  const loaderRef = useRef<{ id: number; controller: AbortController; foreground: boolean } | null>(null);
  /** Canciones que el usuario canceló o cerró con error: no se reintentan solas hasta que las toque o pulse REINTENTAR. */
  const cancelledRef = useRef<Set<number>>(new Set());
  const retryRef = useRef<Map<number, { tries: number; until: number }>>(new Map());
  /** Motivo (límite de uso, cuenta) por el que se detienen las precargas; se limpia al pedir una canción a mano. */
  const blockedRef = useRef<string | null>(null);
  const waitingNoticeRef = useRef<number | null>(null);
  const warnedNextRef = useRef<number | null>(null);
  /** Bytes ya recibidos de la descarga en curso (se suman a lo cargado para comprobar el presupuesto). */
  const inflightBytesRef = useRef(0);

  const addSong = useCallback((name: string, files: File[], options?: { inMemory?: boolean; tone?: string | null; bpm?: number | null; ref?: SongRef; config?: SongConfig; master?: number }): boolean => {
    if (!Array.isArray(files) || files.length === 0) {
      setStatusMessage(`No se pudo añadir ${name}: no contiene pistas válidas.`);
      return false;
    }
    const memoryBytes = options?.inMemory ? files.reduce((sum, file) => sum + file.size, 0) : 0;
    const song: Song = { id: nextId(), name, files, memoryBytes, sizeBytes: 0, songKey: songKeyOf(files), tone: options?.tone, bpm: options?.bpm, ref: options?.ref, config: options?.config };
    const config = options?.config;
    if (config) {
      // Configuración guardada del culto: la mezcla manda sobre los perfiles al activar la canción; los marcadores sustituyen a los locales.
      if (config.tracks.length > 0) mixesRef.current.set(song.id, new Map(config.tracks.map((t) => [t.fileName, { volume: t.volume, pan: t.pan, muted: t.muted, solo: t.solo }])));
      if (config.markers) saveMarkers(songKeyOf(files), config.markers);
      if (config.click || config.pad) extrasRef.current.set(song.id, { click: config.click, pad: config.pad });
    }
    const next = [...playlistRef.current, song];
    playlistRef.current = next;
    setPlaylist(next);
    setStatusMessage(`${name} añadida a la lista (${pistas(files.length)}).`);
    if (activeSongIdRef.current === null) {
      loadSong(song);
      if (options?.master != null) setMasterVolume(options.master);
    }
    return true;
    // loadSong solo toca refs y estado de React; no depende de renders previos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Añade una canción de la nube como REFERENCIA (no descarga nada): la ventana de memoria decide cuándo cargarla. */
  const addSongRef = useCallback((item: { id: string; key: string; title: string; size: number; tone?: string | null; bpm?: number | null }, options?: { config?: SongConfig; master?: number }): boolean => {
    const song: Song = { id: nextId(), name: item.title, files: [], memoryBytes: 0, sizeBytes: item.size, tone: item.tone, bpm: item.bpm, ref: { id: item.id, key: item.key, title: item.title }, config: options?.config };
    const config = options?.config;
    if (config) {
      if (config.tracks.length > 0) mixesRef.current.set(song.id, new Map(config.tracks.map((t) => [t.fileName, { volume: t.volume, pan: t.pan, muted: t.muted, solo: t.solo }])));
      if (config.click || config.pad) extrasRef.current.set(song.id, { click: config.click, pad: config.pad });
    }
    const next = [...playlistRef.current, song];
    playlistRef.current = next;
    setPlaylist(next);
    setStatusMessage(`${item.title} añadida a la lista.`);
    if (activeSongIdRef.current === null) {
      setActiveUnloaded(song);
      if (options?.master != null) setMasterVolume(options.master);
    } else {
      setLoaderTick((tick) => tick + 1);
    }
    return true;
    // setActiveUnloaded solo toca refs y estado de React.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Deja la canción como activa aunque aún no esté cargada (la descarga la gestiona schedule()). */
  function setActiveUnloaded(song: Song) {
    const leaving = activeSongIdRef.current;
    if (leaving !== null && tracksRef.current.length && playlistRef.current.some((item) => item.id === leaving)) {
      mixesRef.current.set(leaving, new Map(tracksRef.current.map((t) => [t.file.name, { volume: t.volume, pan: t.pan, muted: t.muted, solo: t.solo }])));
    }
    if (leaving !== null && playlistRef.current.some((item) => item.id === leaving)) extrasRef.current.set(leaving, currentExtras());
    disposeActiveTracks();
    cancelledRef.current.delete(song.id);
    retryRef.current.delete(song.id);
    activeSongIdRef.current = song.id;
    setActiveSongId(song.id);
    setSongName(song.name);
    setMarkers([]);
    setLoaderTick((tick) => tick + 1);
  }

  const toCatalogSong = (song: Song): CatalogSong => ({
    id: song.ref?.id ?? "", artistId: "", title: song.name, key: song.ref?.key ?? "", size: song.sizeBytes, format: "zip",
    bpm: song.bpm ?? null, tone: song.tone ?? null, modTime: null,
  });
  const toPlanSong = (song: Song): PlanSong => {
    const loaded = song.files.length > 0;
    return { id: song.id, cloud: !!song.ref, loaded, bytes: loaded ? song.memoryBytes || song.files.reduce((sum, file) => sum + file.size, 0) : song.sizeBytes };
  };

  /** Una canción terminó de descargarse: pasa a estar cargada; si es la activa, se monta en el mezclador. */
  function commitLoaded(id: number, files: File[]) {
    const list = playlistRef.current;
    const index = list.findIndex((song) => song.id === id);
    if (index < 0) return; // se quitó mientras descargaba: sus archivos se sueltan solos
    const songKey = songKeyOf(files);
    // En desarrollo, las canciones de la nube falsa («dev://») cuentan por el tamaño del catálogo falso, no por sus pistas de prueba.
    const fake = import.meta.env.DEV && list[index].ref?.key.startsWith("dev://") && !(window as unknown as { __devNet?: { real: boolean } }).__devNet?.real;
    const song: Song = { ...list[index], files, memoryBytes: fake ? list[index].sizeBytes : files.reduce((sum, file) => sum + file.size, 0), songKey };
    if (song.config?.markers) saveMarkers(songKey, song.config.markers);
    const next = [...list];
    next[index] = song;
    playlistRef.current = next;
    setPlaylist(next);
    if (activeSongIdRef.current === id && tracksRef.current.length === 0) loadSong(song);
    setLoaderTick((tick) => tick + 1);
  }

  /** Libera de verdad una canción de la nube que queda fuera de la ventana: suelta sus archivos (y con ellos sus Blobs). */
  function releaseSong(id: number) {
    const list = playlistRef.current;
    const index = list.findIndex((song) => song.id === id);
    if (index < 0 || id === activeSongIdRef.current) return;
    const song = list[index];
    if (!song.ref || song.files.length === 0) return;
    const next = [...list];
    next[index] = { ...song, files: [], memoryBytes: 0 };
    playlistRef.current = next;
    setPlaylist(next);
  }

  const RETRY_MS = [4000, 10000, 20000, 40000, 60000];

  async function runDownload(song: Song, foreground: boolean) {
    const controller = new AbortController();
    loaderRef.current = { id: song.id, controller, foreground };
    if (foreground) blockedRef.current = null;
    setLoadInfo({ id: song.id, percent: null });
    if (foreground) setFg({ id: song.id, stage: "download", percent: null, detail: "", fileName: song.name, error: null });
    const started = performance.now();
    let lastShown = 0;
    const onProgress = (p: SongProgress) => {
      const now = performance.now();
      if (p.stage === "download" && now - lastShown < 250) return;
      lastShown = now;
      inflightBytesRef.current = p.stage === "download" ? p.received : song.sizeBytes;
      const percent = p.stage === "download" ? (p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : null) : (p.total ? Math.round((p.done / p.total) * 100) : null);
      setLoadInfo({ id: song.id, percent: p.stage === "download" ? percent : 100 });
      if (foreground) {
        const speed = p.stage === "download" ? p.received / 1048576 / Math.max((now - started) / 1000, 0.1) : 0;
        const detail = p.stage === "download" ? `${(p.received / 1048576).toFixed(0)} de ${(p.total / 1048576).toFixed(0)} MB · ${speed.toFixed(1)} MB/s` : `Pista ${p.done} de ${p.total}`;
        setFg((current) => (current && current.id === song.id ? { ...current, stage: p.stage, percent, detail } : current));
      }
    };
    try {
      const files = await fetchSongFiles(toCatalogSong(song), onProgress, controller.signal);
      if (controller.signal.aborted) throw new CloudError("cancelled");
      loaderRef.current = null;
      inflightBytesRef.current = 0;
      retryRef.current.delete(song.id);
      setLoadInfo(null);
      if (foreground) setFg(null);
      commitLoaded(song.id, files);
    } catch (error) {
      loaderRef.current = null;
      inflightBytesRef.current = 0;
      setLoadInfo(null);
      if (controller.signal.aborted || (error instanceof CloudError && error.kind === "cancelled")) {
        setFg((current) => (current && current.id === song.id && !current.error ? null : current));
        setLoaderTick((tick) => tick + 1);
        return;
      }
      if (error instanceof CloudError && error.kind === "no_session") { void signOut(); return; }
      const message = friendlyCloudMessage(error);
      if (foreground) {
        cancelledRef.current.add(song.id);
        setFg((current) => ({ ...(current ?? { id: song.id, stage: "download" as const, percent: null, detail: "", fileName: song.name }), error: message, supportReason: error instanceof CloudError && error.showsSupport ? "me salió un error al descargar una canción" : undefined }));
        return;
      }
      if (error instanceof CloudError && error.blocksAll) {
        blockedRef.current = message;
        setStatusMessage(`No se pudo precargar la siguiente. ${message}`);
        return;
      }
      // Fallo de red o del servidor en segundo plano: se reintenta solo, con pausas crecientes, sin tocar el audio de la actual.
      const tries = (retryRef.current.get(song.id)?.tries ?? 0) + 1;
      const delay = RETRY_MS[Math.min(tries - 1, RETRY_MS.length - 1)];
      retryRef.current.set(song.id, { tries, until: Date.now() + delay });
      window.setTimeout(() => setLoaderTick((tick) => tick + 1), delay + 50);
    }
  }

  /** Decide qué soltar y qué descargar según la ventana (activa, anterior y siguientes) y el presupuesto. Se llama tras cada cambio. */
  function schedule() {
    const list = playlistRef.current;
    const activeId = activeSongIdRef.current;
    const activeIndex = list.findIndex((song) => song.id === activeId);
    const plan = planWindow(list.map(toPlanSong), activeIndex, memoryBudget(), MEMORIA, getPreload());
    // 1) Soltar lo que sale de la ventana ANTES de empezar nada nuevo: la memoria nunca pasa del presupuesto.
    for (const id of plan.release) releaseSong(id);
    // 2) Una descarga en curso que ya no hace falta (o que estorba a la de la activa) se corta.
    const current = loaderRef.current;
    const activeSong = list[activeIndex];
    const activeNeedsLoad = !!activeSong && !!activeSong.ref && activeSong.files.length === 0 && !cancelledRef.current.has(activeSong.id);
    if (current && (!plan.keep.includes(current.id) || (activeNeedsLoad && !current.foreground && current.id !== activeId))) current.controller.abort();
    // Aviso discreto si la siguiente no cabe junto a la actual
    if (plan.waiting !== null && activeSong && activeSong.files.length > 0 && waitingNoticeRef.current !== plan.waiting) {
      waitingNoticeRef.current = plan.waiting;
      setStatusMessage("Siguiente en cola: no cabe junto a la actual; se cargará al liberar memoria.");
    } else if (plan.waiting === null) waitingNoticeRef.current = null;
    // 3) Empezar la siguiente descarga (una a la vez)
    if (loaderRef.current || busyRef.current) return;
    for (const id of plan.load) {
      const song = list.find((item) => item.id === id);
      if (!song || cancelledRef.current.has(id)) continue;
      const retry = retryRef.current.get(id);
      if (retry && retry.until > Date.now()) continue;
      const foreground = id === activeId;
      // Las precargas esperan a que la activa termine de prepararse, y no se hacen si algo las detuvo (límite de uso).
      if (!foreground && (blockedRef.current || !preparedRef.current)) continue;
      void runDownload(song, foreground);
      return;
    }
  }

  function cancelForeground() {
    if (fg) cancelledRef.current.add(fg.id);
    loaderRef.current?.controller.abort();
    setFg(null);
    setStatusMessage("Descarga cancelada. Toca la canción para reintentar.");
  }
  function retryForeground() {
    if (fg) { cancelledRef.current.delete(fg.id); retryRef.current.delete(fg.id); }
    blockedRef.current = null;
    setFg(null);
    setLoaderTick((tick) => tick + 1);
  }
  function closeForeground() {
    setFg(null);
    setStatusMessage("No se cargó la canción. Toca la canción para reintentar.");
  }

  function selectSong(song: Song) {
    if (busyRef.current) return;
    if (song.id === activeSongIdRef.current) {
      if (song.files.length === 0 && song.ref) { cancelledRef.current.delete(song.id); retryRef.current.delete(song.id); blockedRef.current = null; setLoaderTick((tick) => tick + 1); }
      return;
    }
    activateSong(song);
  }

  function stepSong(direction: -1 | 1) {
    const list = playlistRef.current;
    if (busyRef.current || list.length === 0) return;
    const index = list.findIndex((song) => song.id === activeSongIdRef.current);
    const target = list[index + direction];
    if (target) activateSong(target);
  }

  /** Vacía el setlist actual (igual que quitar todas las canciones). Devuelve false si hay una operación en curso. */
  function clearSetlist(): boolean {
    if (busyRef.current) return false;
    loaderRef.current?.controller.abort();
    cancelledRef.current.clear();
    retryRef.current.clear();
    blockedRef.current = null;
    setFg(null);
    playlistRef.current = [];
    setPlaylist([]);
    mixesRef.current.clear();
    extrasRef.current.clear();
    peaksCacheRef.current.clear();
    disposeActiveTracks();
    activeSongIdRef.current = null;
    setActiveSongId(null);
    setMarkers([]);
    setSongName("Añade una canción");
    setStatusMessage("La lista está vacía.");
    return true;
  }

  function moveSong(songId: number, direction: -1 | 1) {
    const list = [...playlistRef.current];
    const from = list.findIndex((song) => song.id === songId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    playlistRef.current = list;
    setPlaylist(list);
  }

  function removeSong(songId: number) {
    if (busyRef.current) return;
    if (loaderRef.current?.id === songId) loaderRef.current.controller.abort();
    cancelledRef.current.delete(songId);
    retryRef.current.delete(songId);
    setFg((current) => (current?.id === songId ? null : current));
    const next = playlistRef.current.filter((song) => song.id !== songId);
    playlistRef.current = next;
    setPlaylist(next);
    mixesRef.current.delete(songId);
    extrasRef.current.delete(songId);
    peaksCacheRef.current.delete(songId);
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

  /** Suelta de verdad la pista quitada (pasados UNDO_MS o al cambiar de canción): a partir de aquí ya no se puede deshacer. */
  function finalizePendingRemoval() {
    const pending = pendingRemoval.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingRemoval.current = null;
    setRemovedName(null);
    releaseTrack(pending.track);
  }

  function removeTrack(id: number) {
    if (busyRef.current) return;
    const index = tracksRef.current.findIndex((item) => item.id === id);
    if (index < 0) return;
    const track = tracksRef.current[index];
    finalizePendingRemoval(); // solo se puede deshacer la última pista quitada
    track.audio.pause(); // no se libera todavía: queda lista UNDO_MS por si se deshace
    const next = tracksRef.current.filter((item) => item.id !== id);
    tracksRef.current = next;
    setTracks(next);
    // Sin pistas no hay nada sonando: si no, el estado quedaba en "REPRODUCIENDO" con el botón bloqueado y la pantalla encendida.
    if (next.length === 0) setPlayState(false, false);
    pendingRemoval.current = { track, index, timer: window.setTimeout(finalizePendingRemoval, UNDO_MS) };
    setRemovedName(track.name);
  }

  /** Devuelve al mezclador la última pista quitada, en su lugar, sincronizada con las demás y sonando si la canción suena. */
  function undoRemoval() {
    const pending = pendingRemoval.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingRemoval.current = null;
    setRemovedName(null);
    const rest = tracksRef.current;
    const list = [...rest];
    list.splice(Math.min(pending.index, list.length), 0, pending.track);
    if (rest.length > 0) {
      try { pending.track.audio.currentTime = pickLead(rest).currentTime; } catch { /* sin metadatos aún: la corrección de desfase la alcanza */ }
    }
    tracksRef.current = list;
    setTracks(list);
    applyMix(list);
    if (playingRef.current) void pending.track.audio.play().catch(() => undefined);
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

  useEffect(() => startModalGuard(), []);
  // Al cerrar la app se corta cualquier descarga en curso.
  useEffect(() => () => loaderRef.current?.controller.abort(), []);
  useWakeLock(playing || click.running || padState.playing);
  // La sesión nunca se cierra por inactividad mientras suena algo (pistas, click o pad).
  useEffect(() => { setAudioActive(playing || click.running || padState.playing); }, [playing, click.running, padState.playing]);
  useEffect(() => { setMetersActive(playing); }, [playing]);
  const [fx, setFx] = useFx();
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [markerDraft, setMarkerDraft] = useState<{ marker: Marker; isNew: boolean } | null>(null);
  const [hintShown, setHintShown] = useState(() => !hintDismissed());
  const [slowPrompt, setSlowPrompt] = useState(false);
  // Fotogramas lentos sostenidos (< 40 fps durante 5 s) con efectos Completos: se propone pasar a Reducidos (nunca se cambia en silencio).
  const slowAsked = useRef(false);
  useEffect(() => {
    if (!playing) { stopFpsWatch(); return; }
    startFpsWatch(fx === "full" && !slowAsked.current ? () => { slowAsked.current = true; setSlowPrompt(true); } : null);
    return stopFpsWatch;
  }, [playing, fx]);

  // Detener y Reiniciar cortan el canto: con la canción sonando piden mantener pulsado (ver useHoldToConfirm).
  const holdStop = useHoldToConfirm(() => void stopAll(), playing, () => setStatusMessage("Mantén pulsado para detener"));
  const holdRestart = useHoldToConfirm(() => void playAll(), playing, () => setStatusMessage("Mantén pulsado para reiniciar"));

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
    window.__demoCloud = (count = 10, mb = 300) => {
      for (let i = 1; i <= count; i++) addSongRef({ id: `dev-${i}`, key: `dev://song-${i}`, title: `Canción ${i}`, size: mb * 1048576 });
    };
    window.__mem = () => {
      const list = playlistRef.current;
      const used = list.filter((song) => song.ref).reduce((sum, song) => sum + song.memoryBytes, 0);
      return {
        budget: memoryBudget(), used, inflight: inflightBytesRef.current, activeIndex: list.findIndex((song) => song.id === activeSongIdRef.current),
        songs: list.map((song) => ({ name: song.name, loaded: song.files.length > 0, mb: Math.round(song.memoryBytes / 1048576) })),
        downloading: loaderRef.current ? list.findIndex((song) => song.id === loaderRef.current?.id) : -1,
      };
    };
    window.__demo = async (title = "Todo de nuevo", count = 13, fakeMB = 0, seconds = 60, rate = 22050, stereo = false) => {
      const { makeDemoSong } = await import("./devDemo");
      addSong(title, makeDemoSong(title, count, seconds, fakeMB, undefined, { rate, stereo }), { inMemory: fakeMB > 0 });
    };
  }, [addSong, addSongRef]);

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

  const activeLoaded = (playlist.find((song) => song.id === activeSongId)?.files.length ?? 0) > 0;
  // Forma de onda y análisis de nivel de la canción activa (una vez por canción; al volver a ella ya está hecho).
  useEffect(() => {
    const song = playlistRef.current.find((item) => item.id === activeSongId);
    if (!song || song.files.length === 0) {
      setPeaksLoading(false); // sin canción activa (o aún sin descargar) no hay nada que analizar (evita dejar el aviso "Analizando…" pegado)
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
    // activeLoaded: una canción de la nube activa se analiza cuando termina de descargarse, no al elegirla.
  }, [activeSongId, activeLoaded]);

  useEffect(() => {
    return () => {
      window.clearTimeout(pendingRemoval.current?.timer);
      if (pendingRemoval.current) releaseTrack(pendingRemoval.current.track);
      for (const track of tracksRef.current) releaseTrack(track);
      if (contextRef.current) void contextRef.current.close();
      contextRef.current = null;
      masterGainRef.current = null;
    };
    // releaseTrack solo usa refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Cultos: sesión actual con autoguardado (solo referencias y configuración; nunca audio) ----
  const userId = useUserId();
  const searchMode = useSearchMode() && tab === "library"; // el campo de búsqueda de la Biblioteca tiene el foco
  const [sessionName, setSessionName] = useState(() => defaultSetlistName());
  const [queueBusy, setQueueBusy] = useState(false);
  const sessionDirtyRef = useRef(false);

  /** Canciones de la nube del setlist con la configuración con la que están ahora. Las de "Este dispositivo" no se pueden restaurar. */
  function snapshotSongs(): SavedSong[] {
    const activeId = activeSongIdRef.current;
    const out: SavedSong[] = [];
    for (const song of playlistRef.current) {
      if (!song.ref) continue;
      const live = song.id === activeId && tracksRef.current.length > 0;
      const mix = live
        ? tracksRef.current.map((t) => ({ fileName: t.file.name, volume: t.volume, pan: t.pan, muted: t.muted, solo: t.solo }))
        : [...(mixesRef.current.get(song.id) ?? [])].map(([fileName, m]) => ({ fileName, ...m }));
      const extras = live ? currentExtras() : extrasRef.current.get(song.id);
      out.push({
        ...song.ref,
        tone: song.tone ?? null,
        bpm: song.bpm ?? null,
        config: { tracks: mix, markers: loadMarkers(songKeyOf(song.files)), click: extras?.click, pad: extras?.pad },
      });
    }
    return out;
  }
  const snapshotRef = useRef<() => SavedSession | null>(() => null);
  snapshotRef.current = () => {
    const songs = snapshotSongs();
    return songs.length === 0 ? null : { name: sessionName, updatedAt: Date.now(), master: masterVolumeRef.current, songs };
  };

  // Autoguardado: tras cada cambio (con una pausa corta) y al pasar a segundo plano. No toca nada mientras se carga un culto
  // ni antes de que haya algo de la nube en el setlist (así la tarjeta "Continuar" sigue intacta al abrir la app).
  useEffect(() => {
    if (queueBusy) return;
    if (playlist.some((song) => song.ref)) sessionDirtyRef.current = true;
    if (!sessionDirtyRef.current) return;
    // Nunca se borra solo: vaciar el setlist no destruye lo guardado.
    const write = () => { if (playlistRef.current.some((song) => song.ref)) void saveSession(userId, snapshotRef.current()); };
    const timer = window.setTimeout(write, 700);
    const onHide = () => { if (document.visibilityState === "hidden") { window.clearTimeout(timer); write(); } };
    document.addEventListener("visibilitychange", onHide);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", onHide); };
  }, [playlist, tracks, masterVolume, markers, click, padState.note, padState.sharp, padState.minor, padState.volume, activeSongId, sessionName, userId, queueBusy]);

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

  // La ventana de memoria se recalcula tras cada cambio: canciones, activa, ajuste de precarga, fin de preparación o de una descarga.
  useEffect(() => {
    schedule();
    // schedule solo usa refs y setters estables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist, activeSongId, preloadOn, preparing, loaderTick]);

  // «Siguiente en preparación»: si la actual está por terminar y la siguiente aún no está lista, se avisa una vez (el audio no se toca).
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const { time, duration } = getClock();
      if (!(duration > 0) || duration - time > 30) return;
      const list = playlistRef.current;
      const index = list.findIndex((song) => song.id === activeSongIdRef.current);
      const next = list[index + 1];
      if (next && next.ref && next.files.length === 0 && warnedNextRef.current !== activeSongIdRef.current) {
        warnedNextRef.current = activeSongIdRef.current;
        setStatusMessage("Siguiente en preparación");
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [playing]);

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

  const openLibrary = () => { setShowClick(false); setPadOpen(false); setTab("library"); };
  const openClick = () => { setPadOpen(false); setShowClick(true); };
  // En pantalla ancha el panel va junto al mezclador; en celular se abre como cajón.
  const padInline = wide && padOpen;
  const padDrawer = !wide && padOpen;

  const songState = (song: Song): { state: "ready" | "downloading" | "queued"; percent: number | null } =>
    song.files.length > 0 || !song.ref ? { state: "ready", percent: null } : loadInfo?.id === song.id ? { state: "downloading", percent: loadInfo.percent } : { state: "queued", percent: null };

  const songDeck = (
    <div className="song-deck" aria-label="Repertorio">
      {playlist.length === 0 && (
        <button className="deck-empty" onClick={openLibrary}>Tu repertorio está vacío · toca aquí para añadir canciones</button>
      )}
      {playlist.map((song, index) => (
        <article className={`deck-card ${song.id === activeSongId ? "active" : ""}`} key={song.id}>
          <button className="deck-main" onClick={() => selectSong(song)} title={song.name} aria-label={`Seleccionar ${song.name}`}>
            <Artwork index={index} />
            <span><strong>{song.name}</strong><small>{(() => { const s = songState(song); return s.state === "ready" ? pistas(song.files.length) : s.state === "downloading" ? `Descargando ${s.percent ?? 0}%` : "En cola"; })()}</small></span>
          </button>
          <button className="deck-remove" onClick={() => removeSong(song.id)} aria-label={`Quitar ${song.name}`}>×</button>
        </article>
      ))}
      {playlist.length > 0 && <button className="deck-add" onClick={openLibrary} aria-label="Añadir canciones">＋</button>}
    </div>
  );

  const strip = (track: Track, index: number) => (
    <ChannelStrip
      key={track.id}
      track={track}
      displayName={displayNames[index]}
      dimmed={hasSolo && !track.solo && !track.muted}
      onChange={onTrackChange}
      onRemove={onTrackRemove}
    />
  );
  // "Para el equipo": Click y Guía (por nombre). Van pegados al Master; solo aparecen si existen.
  const teamIndexes = tracks.map((track, index) => (isGuideOrClick(track.name) ? index : -1)).filter((index) => index >= 0);
  const mixer = (
    <div className="channels-box">
      {tracks.length === 0 && <div className="mixer-empty">Selecciona una canción del repertorio para cargar sus pistas.</div>}
      <div className="channels mx" hidden={tracks.length === 0}>
        <ChannelScroll>
          {tracks.map((track, index) => (teamIndexes.includes(index) ? null : strip(track, index)))}
        </ChannelScroll>
        {teamIndexes.length > 0 && (
          <>
            <i className="mx-sep" aria-hidden="true" />
            <section className="mx-team" aria-label="Para el equipo">
              <span className="mx-team-label">PARA EL EQUIPO</span>
              {teamIndexes.map((index) => strip(tracks[index], index))}
            </section>
          </>
        )}
        <MasterStrip volume={masterVolume} onVolume={setMasterVolume} normMode={normMode} onNormMode={() => setNormMode((mode) => NORM_MODES[(NORM_MODES.indexOf(mode) + 1) % NORM_MODES.length])} />
      </div>
    </div>
  );

  return (
    <main className="app" data-searching={searchMode ? "true" : undefined}>
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
            <Icon name="metronome" /><span className="btn-label">CLICK</span><ClickPulse metronome={metronome} />
          </button>
          <button
            className={`glass-btn pad-btn ${padState.playing ? "is-running" : ""} ${padOpen ? "is-open" : ""}`}
            onClick={() => { setShowClick(false); setPadOpen((value) => !value); }}
            aria-pressed={padOpen}
            aria-label="Abrir el panel de pads"
          >
            PAD
          </button>
          <HeaderClock showTotal={tab !== "mixer"} />
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
          <button {...holdStop} className={`icon-btn ${holdStop.className}`} disabled={resetting || tracks.length === 0} aria-label="Detener" title={playing ? "Mantén pulsado para detener" : "Detener"}>
            <svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
          </button>
          <button className="icon-btn" onClick={() => stepSong(1)} disabled={resetting || activeIndex < 0 || activeIndex >= playlist.length - 1} aria-label="Canción siguiente">
            <svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
          </button>
        </div>

        <div className="top-tools">
          {/* Mientras suena, el aviso de pantalla lenta es esta fichita en la cabecera (no tapa los faders); al detener, aparece el cuadro de siempre. */}
          {slowPrompt && playing && (
            <button className="slow-chip" onClick={() => { setFx("reduced"); setSlowPrompt(false); setStatusMessage("Animaciones: Reducidas"); }} title="La pantalla va lenta: pasar a animaciones reducidas">
              LENTA · REDUCIR
            </button>
          )}
          {/* Estado de las pistas (preparando, sincronizadas, en vivo): lo muestran el Play y la barra de carga; queda solo para lectores de pantalla */}
          <span className="sr-only" role="status">{syncLabel}</span>
          <button {...holdRestart} className={`glass-btn restart-btn ${holdRestart.className}`} disabled={resetting || tracks.length === 0} aria-label="Reiniciar desde el principio" title={playing ? "Mantén pulsado para reiniciar" : "Reiniciar desde el principio"}>
            <Icon name="restart" /><span>REINICIAR</span>
          </button>
        </div>
      </header>

      {searchMode && playing && <div className="search-now" role="status" aria-label={`Reproduciendo: ${songName}`} title={`Reproduciendo: ${songName}`}><i aria-hidden="true" /></div>}

      {tab === "setlist" && (
        <SetlistScreen
          songs={playlist.map((song) => ({ id: song.id, name: song.name, tracks: song.files.length, tone: song.tone, bpm: song.bpm, ...songState(song) }))}
          activeId={activeSongId}
          playing={playing}
          onOpen={(id) => { const song = playlist.find((item) => item.id === id); if (song) selectSong(song); setTab("mixer"); }}
          onMove={moveSong}
          onRemove={removeSong}
          onAdd={openLibrary}
          extra={
            <SavedSetlists
              userId={userId}
              current={playlist.map((song) => ({ name: song.name, ref: song.ref }))}
              sessionName={sessionName}
              onSessionName={setSessionName}
              getSnapshot={() => ({ songs: snapshotSongs(), master: masterVolumeRef.current })}
              onBusyChange={setQueueBusy}
              onClear={clearSetlist}
              onAddRef={addSongRef}
            />
          }
        />
      )}

      {tab === "mixer" && (
        <section className="screen" aria-label="En vivo">
          <div className="live-status">
            <div className="session-pill"><i className={playing ? "active" : ""} />SESIÓN EN VIVO<b>{click.beats}/4</b></div>
            <button className="loaded-song" onClick={() => tracks.length > 0 && setExpanded(true)} aria-label="Abrir el reproductor ampliado">
              <Artwork index={Math.max(0, activeIndex)} />
              <span><small>CANCIÓN CARGADA</small><strong>{songName || "Ninguna"}</strong></span>
            </button>
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
            <div className="wave-songline">
              <span className="wave-songname">{songName}</span>
              <SectionName markers={markers} />
            </div>
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

      {tab === "library" && (
        <section className="screen library-screen" aria-label="Biblioteca">
          <div className="lib-head">
            <div><span className="eyebrow">CRESCENDO LIVE</span><h1>Biblioteca</h1></div>
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
          <div className="library-body">
            {source === "local"
              ? <div className="library-scroll"><LocalImport onSongLoaded={addSong} /></div>
              : <NubeBrowser onSongRef={addSongRef} />}
          </div>
        </section>
      )}

      {tab === "settings" && (
        <SettingsScreen
          normMode={normMode}
          onNormMode={setNormMode}
          getDiagnostics={getDiagnostics}
        />
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
      {removedName && !markerDraft && (
        <div className="app-toast undo-toast" role="status" aria-live="polite" key="undo">
          <span>Pista «{removedName}» eliminada</span>
          <button className="undo-btn" onClick={undoRemoval}>DESHACER</button>
        </div>
      )}
      {statusMessage && !markerDraft && (
        <div className="app-toast" role="status" aria-live="polite" key={statusMessage}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /></svg>
          <span>{statusMessage}</span>
        </div>
      )}

      {tab !== "mixer" && tracks.length > 0 && (
        <div className="mini-player">
          {/* Una sola línea: abre el reproductor ampliado. El Play y el transporte están siempre en la cabecera. */}
          <button className="mini-main" onClick={() => setExpanded(true)} aria-label="Abrir el reproductor ampliado">
            <span className="mini-copy"><strong>{songName}</strong><small>{playing ? "Reproduciendo" : paused ? "En pausa" : "Detenido"} · {pistas(tracks.length)}</small></span>
            {(playing || click.running || padState.playing) && <i className="mini-live" aria-hidden="true" />}
          </button>
        </div>
      )}

      <nav className="tab-bar" aria-label="Navegación principal" style={{ "--tab-i": ["library", "setlist", "mixer", "settings"].indexOf(tab) } as React.CSSProperties}>
        <button className={tab === "library" ? "active" : ""} aria-current={tab === "library" ? "page" : undefined} onClick={() => setTab("library")}><Icon name="library" /><span>Biblioteca</span></button>
        <button className={tab === "setlist" ? "active" : ""} aria-current={tab === "setlist" ? "page" : undefined} onClick={() => setTab("setlist")}><Icon name="setlist" /><span>Setlist</span></button>
        <button className={tab === "mixer" ? "active" : ""} aria-current={tab === "mixer" ? "page" : undefined} onClick={() => setTab("mixer")}><Icon name="mixer" /><span>Mezclador</span></button>
        <button className={tab === "settings" ? "active" : ""} aria-current={tab === "settings" ? "page" : undefined} onClick={() => setTab("settings")}><Icon name="settings" /><span>Ajustes</span></button>
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

      {fg && (
        <LoadCard
          stage={fg.stage}
          percent={fg.percent}
          detail={fg.detail}
          fileName={fg.fileName}
          error={fg.error}
          supportReason={fg.supportReason}
          onCancel={cancelForeground}
          onRetry={retryForeground}
          onClose={closeForeground}
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

      {slowPrompt && !playing && (
        <div className="slow-prompt" role="alertdialog" aria-label="Fotogramas lentos">
          <span>La pantalla va lenta. ¿Pasar a animaciones reducidas?</span>
          <button className="pill-btn" onClick={() => setSlowPrompt(false)}>NO, GRACIAS</button>
          <button className="pill-btn primary" onClick={() => { setFx("reduced"); setSlowPrompt(false); setStatusMessage("Animaciones: Reducidas"); }}>REDUCIR</button>
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
