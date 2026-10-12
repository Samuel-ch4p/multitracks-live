export type ClickSound = "classic" | "wood" | "hat";
export type ClickOutput = "mix" | "left";

export type ClickSettings = {
  bpm: number;
  beats: number; // pulsos por compás (1..12)
  subdivision: number; // 1 = ninguna, 2 = corcheas, 3 = tresillos, 4 = semicorcheas
  accent: boolean; // acento en el primer pulso
  sound: ClickSound;
  output: ClickOutput;
  volume: number; // 0..100
};

export type ClickState = ClickSettings & { running: boolean };

export const BPM_MIN = 30;
export const BPM_MAX = 300;

const STORAGE_KEY = "crescendo-click-v1";

const DEFAULTS: ClickSettings = {
  bpm: 100,
  beats: 4,
  subdivision: 1,
  accent: true,
  sound: "classic",
  output: "mix",
  volume: 70,
};

const SOUNDS: ClickSound[] = ["classic", "wood", "hat"];
const OUTPUTS: ClickOutput[] = ["mix", "left"];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Valida y limita cualquier valor que venga de la interfaz o del almacenamiento. */
function sanitize(input: Partial<ClickSettings>, base: ClickSettings): ClickSettings {
  const next = { ...base };
  if (isNumber(input.bpm)) next.bpm = Math.round(clamp(input.bpm, BPM_MIN, BPM_MAX));
  if (isNumber(input.beats)) next.beats = Math.round(clamp(input.beats, 1, 12));
  if (isNumber(input.subdivision)) next.subdivision = Math.round(clamp(input.subdivision, 1, 4));
  if (typeof input.accent === "boolean") next.accent = input.accent;
  if (input.sound && SOUNDS.includes(input.sound)) next.sound = input.sound;
  if (input.output && OUTPUTS.includes(input.output)) next.output = input.output;
  if (isNumber(input.volume)) next.volume = Math.round(clamp(input.volume, 0, 100));
  return next;
}

function loadSaved(): Partial<ClickSettings> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? (parsed as Partial<ClickSettings>) : {};
  } catch {
    return {};
  }
}

type TickKind = "accent" | "beat" | "sub";

/**
 * Click con reloj de audio: cada golpe se programa unos milisegundos antes de sonar,
 * así el tempo no se corre aunque la pantalla vaya lenta.
 */
export class Metronome {
  private settings: ClickSettings;
  private state: ClickState;
  private beat = -1;

  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private panner: StereoPannerNode | null = null;
  private noise: AudioBuffer | null = null;

  private timer: number | null = null;
  private runId = 0;
  private nextTime = 0;
  private beatIdx = 0;
  private subIdx = 0;
  private taps: number[] = [];

  private stateListeners = new Set<() => void>();
  private beatListeners = new Set<() => void>();

  constructor() {
    this.settings = sanitize(loadSaved(), DEFAULTS);
    this.state = { ...this.settings, running: false };
  }

  // --- Suscripción para React (useSyncExternalStore) ---
  subscribe = (listener: () => void) => {
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  };
  getState = () => this.state;

  subscribeBeat = (listener: () => void) => {
    this.beatListeners.add(listener);
    return () => { this.beatListeners.delete(listener); };
  };
  getBeat = () => this.beat;

  private emitState() {
    this.stateListeners.forEach((listener) => listener());
  }
  private emitBeat() {
    this.beatListeners.forEach((listener) => listener());
  }

  // --- Ajustes ---
  set(changes: Partial<ClickSettings>) {
    this.settings = sanitize(changes, this.settings);
    this.state = { ...this.settings, running: this.state.running };
    this.applyGraph();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Sin almacenamiento: los ajustes valen solo para esta sesión.
    }
    this.emitState();
  }

  /** Marca el tempo tocando: promedia los últimos toques y reinicia si pasan más de 2 s. */
  tap() {
    const now = performance.now();
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2000) this.taps = [];
    this.taps = [...this.taps, now].slice(-6);
    if (this.taps.length < 2) return;
    const spans = this.taps.slice(1).map((time, i) => time - this.taps[i]);
    const average = spans.reduce((sum, span) => sum + span, 0) / spans.length;
    this.set({ bpm: 60000 / average });
  }

  // --- Reproducción ---
  async start() {
    if (this.state.running) return;
    const id = ++this.runId;
    try {
      const ctx = this.buildGraph();
      this.state = { ...this.state, running: true };
      this.emitState();
      await ctx.resume();
      if (id !== this.runId) return;
      this.beatIdx = 0;
      this.subIdx = 0;
      this.nextTime = ctx.currentTime + 0.08;
      this.timer = window.setInterval(() => this.schedule(id), 25);
      this.schedule(id);
    } catch (error) {
      console.error("No se pudo iniciar el click:", error);
      this.stop();
    }
  }

  stop() {
    this.runId++;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    // Desconecta el bus: los golpes ya programados quedan en silencio al instante.
    this.bus?.disconnect();
    this.bus = null;
    this.panner = null;
    this.beat = -1;
    if (this.state.running) {
      this.state = { ...this.state, running: false };
      this.emitState();
    }
    this.emitBeat();
    const ctx = this.ctx;
    window.setTimeout(() => {
      if (!this.state.running && ctx && ctx.state === "running") void ctx.suspend();
    }, 250);
  }

  dispose() {
    this.stop();
    const ctx = this.ctx;
    this.ctx = null;
    this.noise = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }

  // --- Audio ---
  private buildGraph(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      const Ctor = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error("Este navegador no admite Web Audio API.");
      this.ctx = new Ctor({ latencyHint: "interactive" });
      this.noise = null;
    }
    const ctx = this.ctx;
    this.bus?.disconnect();
    this.bus = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.bus.connect(this.panner);
    this.panner.connect(ctx.destination);
    this.applyGraph(true);
    return ctx;
  }

  private applyGraph(immediate = false) {
    const ctx = this.ctx;
    if (!ctx || !this.bus || !this.panner) return;
    const gain = Math.pow(this.settings.volume / 100, 1.6);
    const pan = this.settings.output === "left" ? -1 : 0;
    if (immediate) {
      this.bus.gain.value = gain;
      this.panner.pan.value = pan;
    } else {
      this.bus.gain.setTargetAtTime(gain, ctx.currentTime, 0.01);
      this.panner.pan.setTargetAtTime(pan, ctx.currentTime, 0.01);
    }
  }

  private schedule(id: number) {
    const ctx = this.ctx;
    if (!ctx || id !== this.runId) return;
    // Si el sistema congeló el temporizador (pantalla bloqueada), reengancha sin ráfaga de golpes.
    if (this.nextTime < ctx.currentTime - 0.1) this.nextTime = ctx.currentTime + 0.02;
    const horizon = ctx.currentTime + 0.12;
    while (this.nextTime < horizon) {
      const { beats, subdivision, bpm, accent } = this.settings;
      if (this.subIdx >= subdivision) {
        this.subIdx = 0;
        this.beatIdx++;
      }
      if (this.beatIdx >= beats) this.beatIdx = 0;
      const onBeat = this.subIdx === 0;
      const kind: TickKind = onBeat ? (this.beatIdx === 0 && accent ? "accent" : "beat") : "sub";
      this.playTick(this.nextTime, kind);
      if (onBeat) this.announceBeat(this.nextTime, this.beatIdx, id);
      this.subIdx++;
      this.nextTime += 60 / bpm / subdivision;
    }
  }

  /** Enciende el indicador visual justo cuando suena el pulso. */
  private announceBeat(time: number, index: number, id: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    window.setTimeout(() => {
      if (id !== this.runId || !this.state.running) return;
      this.beat = index;
      this.emitBeat();
    }, Math.max(0, (time - ctx.currentTime) * 1000));
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    return this.noise;
  }

  private playTick(time: number, kind: TickKind) {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    const level = kind === "accent" ? 1 : kind === "beat" ? 0.8 : 0.38;
    const sound = this.settings.sound;

    if (sound === "hat") {
      const length = kind === "accent" ? 0.09 : 0.045;
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = kind === "accent" ? 5200 : 7000;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(level * 0.9, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + length);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(bus);
      source.start(time, Math.random() * 0.5, length + 0.01);
      return;
    }

    const frequency = kind === "accent" ? 1568 : kind === "beat" ? 1175 : 880;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    let duration: number;
    if (sound === "wood") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(frequency * 1.35, time);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.85, time + 0.03);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(level * 0.9, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
      duration = 0.08;
    } else {
      osc.type = "square";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(level * 0.5, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
      duration = 0.055;
    }
    osc.connect(gain);
    gain.connect(bus);
    osc.start(time);
    osc.stop(time + duration); // stop() siempre después de start()
  }
}
