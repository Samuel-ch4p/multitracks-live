export type PadNote = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export const PAD_NOTES: PadNote[] = ["C", "D", "E", "F", "G", "A", "B"];

export type PadSettings = {
  note: PadNote;
  sharp: boolean;
  minor: boolean;
  volume: number; // 0..100
};
export type PadState = PadSettings & { playing: boolean; loading: boolean };

export function chordName(note: PadNote, sharp: boolean, minor: boolean) {
  return `${note}${sharp ? "♯" : ""}${minor ? "m" : ""}`;
}

/**
 * Audios de los pads (ciclos cortos sin corte, en public/pads/).
 * Para añadir más (menores, sostenidos) basta con poner el archivo y una línea aquí:
 *   "Cm": "Cm.ogg", "C♯": "Cs.ogg", "C♯m": "Csm.ogg"
 */
const SAMPLES: Record<string, string> = {
  C: "C.ogg",
  D: "D.ogg",
  E: "E.ogg",
  F: "F.ogg",
  G: "G.ogg",
  A: "A.ogg",
  B: "B.ogg",
  "C♯": "Cs.ogg",
  "D♯": "Ds.ogg",
  "F♯": "Fs.ogg",
  "G♯": "Gs.ogg",
  "A♯": "As.ogg",
  Cm: "Cm.ogg",
  Dm: "Dm.ogg",
  Em: "Em.ogg",
  Fm: "Fm.ogg",
  Gm: "Gm.ogg",
  Am: "Am.ogg",
  Bm: "Bm.ogg",
};

export const hasChord = (note: PadNote, sharp: boolean, minor: boolean) => chordName(note, sharp, minor) in SAMPLES;
/** ¿Hay algún audio con ese tipo de variación? Sirve para habilitar los botones ♯ y m. */
export const hasVariant = (variant: "sharp" | "minor") =>
  PAD_NOTES.some((note) => (variant === "sharp" ? hasChord(note, true, false) : hasChord(note, false, true)));

const STORAGE_KEY = "crescendo-pad-v2";
const DEFAULTS: PadSettings = { note: "C", sharp: false, minor: false, volume: 60 };

// Fundidos con rampas de inicio y fin exactos: el acorde llega a cero antes de detener su audio.
const FADE_IN = 2.0; // s para entrar desde silencio
const FADE_CHANGE = 1.4; // s del cruce entre un acorde y el siguiente (potencia pareja)
const FADE_OUT_STOP = 0.8; // s para apagar con APAGAR o al tocar la misma nota

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Ajusta cualquier combinación a una que tenga audio disponible. */
function sanitize(input: Partial<PadSettings>, base: PadSettings): PadSettings {
  const next = { ...base };
  if (input.note && PAD_NOTES.includes(input.note)) next.note = input.note;
  if (typeof input.sharp === "boolean") next.sharp = input.sharp;
  if (typeof input.minor === "boolean") next.minor = input.minor;
  if (typeof input.volume === "number" && Number.isFinite(input.volume)) next.volume = Math.round(clamp(input.volume, 0, 100));
  if (!hasChord(next.note, next.sharp, next.minor)) {
    next.sharp = false;
    next.minor = false;
  }
  return next;
}

function loadSaved(): Partial<PadSettings> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? (parsed as Partial<PadSettings>) : {};
  } catch {
    return {};
  }
}

type Voice = { gain: GainNode; source: AudioBufferSourceNode };

/** Pad sostenido con tus audios: cada acorde se repite en ciclo y se cruza con el siguiente. */
export class PadEngine {
  private settings: PadSettings;
  private state: PadState;

  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private voice: Voice | null = null;
  private suspendTimer: number | null = null;
  private runId = 0;

  private buffers = new Map<string, AudioBuffer>();
  private loads = new Map<string, Promise<AudioBuffer>>();

  private listeners = new Set<() => void>();

  constructor() {
    this.settings = sanitize(loadSaved(), DEFAULTS);
    this.state = { ...this.settings, playing: false, loading: false };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getState = () => this.state;

  private commit(changes: { playing?: boolean; loading?: boolean } = {}) {
    this.state = { ...this.settings, playing: changes.playing ?? this.state.playing, loading: changes.loading ?? this.state.loading };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Sin almacenamiento: los ajustes valen solo para esta sesión.
    }
    this.listeners.forEach((listener) => listener());
  }

  /** Cambia nota, sostenido, menor o volumen. Si está sonando, el acorde cambia con cruce suave. */
  set(changes: Partial<PadSettings>) {
    const before = chordName(this.settings.note, this.settings.sharp, this.settings.minor);
    // No hay acordes sostenido + menor: al activar uno se apaga el otro (antes se apagaban los dos).
    const adjusted = { ...changes };
    if (adjusted.sharp === true && adjusted.minor === undefined) adjusted.minor = false;
    if (adjusted.minor === true && adjusted.sharp === undefined) adjusted.sharp = false;
    this.settings = sanitize(adjusted, this.settings);
    this.applyVolume();
    const after = chordName(this.settings.note, this.settings.sharp, this.settings.minor);
    this.commit();
    if (this.state.playing && after !== before) void this.start();
  }

  /** Toca una nota: si ya suena ese mismo acorde, lo apaga. */
  toggleNote(note: PadNote) {
    const { sharp, minor } = this.settings;
    if (!hasChord(note, sharp, minor)) return;
    if (this.state.playing && this.settings.note === note) {
      this.stop();
      return;
    }
    this.settings = { ...this.settings, note };
    this.commit();
    void this.start();
  }

  /** Decodifica los audios con calma para que el primer toque no se retrase. */
  preload() {
    try {
      this.ensureContext();
    } catch {
      return;
    }
    // Solo el acorde elegido: cada audio decodificado ocupa ~11 MB y ahora hay 19.
    const { note, sharp, minor } = this.settings;
    this.load(chordName(note, sharp, minor)).catch(() => { /* se reintenta al tocar */ });
  }

  async start() {
    const id = ++this.runId;
    const key = chordName(this.settings.note, this.settings.sharp, this.settings.minor);
    try {
      const ctx = this.ensureContext();
      if (this.suspendTimer !== null) { window.clearTimeout(this.suspendTimer); this.suspendTimer = null; }
      const resumed = ctx.resume();
      if (!this.buffers.has(key)) this.commit({ loading: true });
      const buffer = await this.load(key);
      await resumed;
      if (id !== this.runId) return; // llegó otro toque mientras cargaba
      const now = ctx.currentTime;
      const crossing = this.voice !== null;
      this.releaseVoice(now, FADE_CHANGE);
      this.voice = this.createVoice(ctx, buffer, now, crossing ? FADE_CHANGE : FADE_IN);
      this.commit({ playing: true, loading: false });
    } catch (error) {
      console.error("No se pudo iniciar el pad:", error);
      if (id === this.runId) {
        this.stop();
        this.commit({ loading: false });
      }
    }
  }

  stop() {
    this.runId++;
    const ctx = this.ctx;
    if (ctx) this.releaseVoice(ctx.currentTime, FADE_OUT_STOP);
    this.commit({ playing: false, loading: false });
    if (ctx) {
      // El audio se suspende solo cuando el fundido ya terminó.
      if (this.suspendTimer !== null) window.clearTimeout(this.suspendTimer);
      this.suspendTimer = window.setTimeout(() => {
        if (!this.state.playing && ctx.state === "running") void ctx.suspend();
      }, (FADE_OUT_STOP + 0.5) * 1000);
    }
  }

  dispose() {
    this.runId++;
    if (this.suspendTimer !== null) window.clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    this.voice = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.out = null;
    this.buffers.clear();
    this.loads.clear();
    if (ctx && ctx.state !== "closed") void ctx.close();
  }

  // --- Audio ---
  private ensureContext(): AudioContext {
    if (this.ctx && this.ctx.state !== "closed") return this.ctx;
    const Ctor = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error("Este navegador no admite Web Audio API.");
    const ctx = new Ctor({ latencyHint: "playback" });
    this.ctx = ctx;
    this.buffers.clear();
    this.loads.clear();
    const out = ctx.createGain();
    out.connect(ctx.destination);
    this.out = out;
    this.applyVolume(true);
    return ctx;
  }

  private load(key: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.loads.get(key);
    if (pending) return pending;
    const ctx = this.ensureContext();
    const file = SAMPLES[key];
    if (!file) return Promise.reject(new Error(`No hay audio para ${key}.`));
    const task = (async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}pads/${file}`);
      if (!response.ok) throw new Error(`No se pudo leer pads/${file}.`);
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      if (this.ctx === ctx) {
        this.buffers.set(key, buffer);
        // Máximo 4 acordes en memoria; el que suena conserva su propia referencia.
        while (this.buffers.size > 4) this.buffers.delete(this.buffers.keys().next().value as string);
      }
      return buffer;
    })();
    this.loads.set(key, task);
    task.catch(() => { this.loads.delete(key); });
    return task;
  }

  private applyVolume(immediate = false) {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const gain = Math.pow(this.settings.volume / 100, 1.6) * 0.9;
    if (immediate) this.out.gain.value = gain;
    else this.out.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
  }

  private createVoice(ctx: AudioContext, buffer: AudioBuffer, time: number, fadeIn: number): Voice {
    // Entrada con curva de seno: con la salida en coseno del acorde anterior, el volumen total queda parejo.
    const gain = ctx.createGain();
    const curve = new Float32Array(64);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.sin((i / (curve.length - 1)) * Math.PI / 2);
    gain.gain.setValueAtTime(0, time);
    gain.gain.setValueCurveAtTime(curve, time, fadeIn);
    gain.connect(this.out as GainNode);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start(time);
    return { gain, source };
  }

  private holdParam(param: AudioParam, time: number) {
    // Primero se borra lo que empieza en este instante (dos cambios seguidos en el mismo tick) y luego se congela lo que ya venía en curso.
    param.cancelScheduledValues(time);
    if (typeof param.cancelAndHoldAtTime === "function") {
      param.cancelAndHoldAtTime(time);
    } else {
      const held = param.value;
      param.cancelScheduledValues(time);
      param.setValueAtTime(held, time);
    }
  }

  /** Baja el acorde a cero con curva de coseno y luego detiene su audio. */
  private releaseVoice(time: number, seconds: number) {
    const voice = this.voice;
    this.voice = null;
    if (!voice) return;
    const param = voice.gain.gain;
    const held = clamp(param.value, 0, 1);
    this.holdParam(param, time);
    const curve = new Float32Array(64);
    for (let i = 0; i < curve.length; i++) curve[i] = held * Math.cos((i / (curve.length - 1)) * Math.PI / 2);
    param.setValueCurveAtTime(curve, time, seconds);
    try { voice.source.stop(time + seconds + 0.05); } catch { /* ya estaba detenido */ }
    window.setTimeout(() => {
      try { voice.source.disconnect(); voice.gain.disconnect(); } catch { /* ya desconectado */ }
    }, (seconds + 0.5) * 1000);
  }
}
