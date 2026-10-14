export type PadNote = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export const PAD_NOTES: PadNote[] = ["C", "D", "E", "F", "G", "A", "B"];

const SEMITONE: Record<PadNote, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export type PadSettings = {
  note: PadNote;
  sharp: boolean;
  minor: boolean;
  volume: number; // 0..100
};
export type PadState = PadSettings & { playing: boolean };

const STORAGE_KEY = "crescendo-pad-v1";
const DEFAULTS: PadSettings = { note: "C", sharp: false, minor: false, volume: 60 };

const ATTACK = 0.9; // constante de tiempo de entrada (s): ~3 s hasta llegar a pleno
const RELEASE = 1.3; // constante de tiempo de salida (s): ~4 s hasta apagarse
const CLEANUP_AFTER = 8; // s después de soltar un acorde se liberan sus osciladores

export function chordName(note: PadNote, sharp: boolean, minor: boolean) {
  return `${note}${sharp ? "♯" : ""}${minor ? "m" : ""}`;
}

const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

type Layer = { freq: number; level: number; wave: "saw" | "sine" };

/**
 * Voicing abierto, típico de pad de adoración: fundamental grave, quinta, octava,
 * tercera arriba y un brillo suave de quinta alta. Las capas saw dan calor y las
 * sine dan cuerpo.
 */
export function chordLayers(note: PadNote, sharp: boolean, minor: boolean): Layer[] {
  const root = 36 + SEMITONE[note] + (sharp ? 1 : 0); // C2 como base
  const third = minor ? 3 : 4;
  const m = (offset: number) => midiToFreq(root + offset);
  return [
    { freq: m(0), level: 0.9, wave: "sine" },
    { freq: m(12), level: 0.8, wave: "saw" },
    { freq: m(12 + 7), level: 0.6, wave: "saw" },
    { freq: m(24), level: 0.5, wave: "saw" },
    { freq: m(24 + third), level: 0.55, wave: "saw" },
    { freq: m(24 + 7), level: 0.45, wave: "sine" },
    { freq: m(36), level: 0.18, wave: "sine" },
    { freq: m(36 + 7), level: 0.1, wave: "sine" },
  ];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function sanitize(input: Partial<PadSettings>, base: PadSettings): PadSettings {
  const next = { ...base };
  if (input.note && PAD_NOTES.includes(input.note)) next.note = input.note;
  if (typeof input.sharp === "boolean") next.sharp = input.sharp;
  if (typeof input.minor === "boolean") next.minor = input.minor;
  if (typeof input.volume === "number" && Number.isFinite(input.volume)) next.volume = Math.round(clamp(input.volume, 0, 100));
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

type Voice = { gain: GainNode; nodes: AudioScheduledSourceNode[]; filter: BiquadFilterNode };

/** Pad ambiental sostenido: cada acorde entra y sale con fundido cruzado. */
export class PadEngine {
  private settings: PadSettings;
  private state: PadState;

  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private bus: GainNode | null = null;
  private voice: Voice | null = null;
  private suspendTimer: number | null = null;

  private listeners = new Set<() => void>();

  constructor() {
    this.settings = sanitize(loadSaved(), DEFAULTS);
    this.state = { ...this.settings, playing: false };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getState = () => this.state;

  private commit(playing = this.state.playing) {
    this.state = { ...this.settings, playing };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Sin almacenamiento: los ajustes valen solo para esta sesión.
    }
    this.listeners.forEach((listener) => listener());
  }

  /** Cambia tercera/sostenido/volumen. Si está sonando, el acorde se transforma con fundido. */
  set(changes: Partial<PadSettings>) {
    this.settings = sanitize(changes, this.settings);
    this.applyVolume();
    const retune = this.state.playing && (changes.note !== undefined || changes.sharp !== undefined || changes.minor !== undefined);
    this.commit();
    if (retune) void this.start();
  }

  /** Toca una nota: si ya suena ese mismo acorde, lo apaga. */
  toggleNote(note: PadNote) {
    if (this.state.playing && this.settings.note === note) {
      this.stop();
      return;
    }
    this.settings = { ...this.settings, note };
    this.commit();
    void this.start();
  }

  async start() {
    try {
      const ctx = this.ensureContext();
      if (this.suspendTimer !== null) { window.clearTimeout(this.suspendTimer); this.suspendTimer = null; }
      await ctx.resume();
      const now = ctx.currentTime;
      this.releaseVoice(now);
      this.voice = this.createVoice(ctx, now);
      this.commit(true);
    } catch (error) {
      console.error("No se pudo iniciar el pad:", error);
      this.stop();
    }
  }

  stop() {
    const ctx = this.ctx;
    if (ctx) this.releaseVoice(ctx.currentTime);
    if (this.state.playing) this.commit(false);
    if (ctx) {
      if (this.suspendTimer !== null) window.clearTimeout(this.suspendTimer);
      this.suspendTimer = window.setTimeout(() => {
        if (!this.state.playing && ctx.state === "running") void ctx.suspend();
      }, (CLEANUP_AFTER + 1) * 1000);
    }
  }

  dispose() {
    if (this.suspendTimer !== null) window.clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    this.voice = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.out = null;
    this.bus = null;
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

    const out = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.02;
    limiter.release.value = 0.4;
    out.connect(limiter);
    limiter.connect(ctx.destination);

    const bus = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.6;
    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(ctx, 5.5);
    const wet = ctx.createGain();
    wet.gain.value = 0.75;
    bus.connect(dry);
    dry.connect(out);
    bus.connect(reverb);
    reverb.connect(wet);
    wet.connect(out);

    this.out = out;
    this.bus = bus;
    this.applyVolume(true);
    return ctx;
  }

  /** Reverberación larga y oscura generada con ruido que se apaga: da el aire de "atmósfera". */
  private impulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const noise = Math.random() * 2 - 1;
        last += (noise - last) * (0.55 - 0.45 * t); // se oscurece con el tiempo
        data[i] = last * Math.pow(1 - t, 2.6);
      }
    }
    return buffer;
  }

  private applyVolume(immediate = false) {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    const gain = Math.pow(this.settings.volume / 100, 1.6) * 0.9;
    if (immediate) this.out.gain.value = gain;
    else this.out.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
  }

  private createVoice(ctx: AudioContext, time: number): Voice {
    const { note, sharp, minor } = this.settings;
    const layers = chordLayers(note, sharp, minor);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.setTargetAtTime(1, time, ATTACK);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1150;
    filter.Q.value = 0.4;
    filter.connect(gain);
    gain.connect(this.bus as GainNode);

    const nodes: AudioScheduledSourceNode[] = [];

    // Movimiento lento del filtro: el pad "respira".
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 320;
    lfo.connect(lfoDepth);
    lfoDepth.connect(filter.frequency);
    lfo.start(time);
    nodes.push(lfo);

    const perLayer = 0.16;
    for (const layer of layers) {
      const detunes = layer.wave === "saw" ? [-7, 0, 7] : [0];
      for (const cents of detunes) {
        const osc = ctx.createOscillator();
        osc.type = layer.wave === "saw" ? "sawtooth" : "sine";
        osc.frequency.value = layer.freq;
        osc.detune.value = cents;
        const level = ctx.createGain();
        level.gain.value = (perLayer * layer.level) / (layer.wave === "saw" ? detunes.length : 1);
        osc.connect(level);
        level.connect(filter);
        osc.start(time);
        nodes.push(osc);
      }
    }
    return { gain, nodes, filter };
  }

  private releaseVoice(time: number) {
    const voice = this.voice;
    this.voice = null;
    if (!voice) return;
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setTargetAtTime(0, time, RELEASE);
    const stopAt = time + CLEANUP_AFTER;
    for (const node of voice.nodes) {
      try { node.stop(stopAt); } catch { /* ya estaba detenido */ }
    }
    window.setTimeout(() => {
      try { voice.gain.disconnect(); voice.filter.disconnect(); } catch { /* ya desconectado */ }
    }, (CLEANUP_AFTER + 0.5) * 1000);
  }
}
