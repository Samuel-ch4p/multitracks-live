import { getFx } from "./effects";

/**
 * Medidores de nivel "vivos". Leen un AnalyserNode por canal y mueven el relleno con `transform` directamente en el
 * DOM (sin pasar por React, sin re-renders). Un único requestAnimationFrame para todos; se detiene solo cuando no
 * hay señal. El hilo de audio no se toca: el AnalyserNode solo observa.
 */
type Entry = {
  analyser: AnalyserNode | null;
  root: HTMLElement | null;
  fill: HTMLElement | null;
  buffer: Float32Array<ArrayBuffer> | null;
  level: number;
  shownSig: number;
  axis: "x" | "y";
};

const entries = new Map<string, Entry>();
let frame = 0;
let active = false;
let last = 0;

const entry = (key: string): Entry => {
  let e = entries.get(key);
  if (!e) {
    e = { analyser: null, root: null, fill: null, buffer: null, level: 0, shownSig: -1, axis: "y" };
    entries.set(key, e);
  }
  return e;
};

/** Enlaza los elementos del canal: `root` recibe --sig (brillo según señal) y `fill` se escala con el nivel. */
export function bindMeterElements(key: string, root: HTMLElement | null, fill: HTMLElement | null, axis: "x" | "y" = "y") {
  const e = entry(key);
  e.axis = axis;
  e.root = root;
  e.fill = fill;
  if (!root && !fill && !e.analyser) entries.delete(key);
}

export function bindAnalyser(key: string, analyser: AnalyserNode | null) {
  const e = entry(key);
  e.analyser = analyser;
  e.buffer = analyser ? new Float32Array(analyser.fftSize) : null;
  if (!analyser && !e.root && !e.fill) entries.delete(key);
}

/** Enciende o apaga la lectura (true mientras suena algo). Al apagar, los medidores bajan solos y el bucle se detiene. */
export function setMetersActive(on: boolean) {
  active = on;
  if (!frame) frame = requestAnimationFrame(tick);
}

const DB_FLOOR = 54;

function tick(now: number) {
  frame = 0;
  const reduced = getFx() === "reduced";
  const minGap = reduced ? 50 : 24; // ms entre lecturas (≈20 fps / ≈40 fps)
  if (now - last < minGap) {
    frame = requestAnimationFrame(tick);
    return;
  }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let anyMoving = false;

  for (const e of entries.values()) {
    let target = 0;
    if (active && e.analyser && e.buffer) {
      e.analyser.getFloatTimeDomainData(e.buffer);
      let peak = 0;
      for (let i = 0; i < e.buffer.length; i++) {
        const v = e.buffer[i] < 0 ? -e.buffer[i] : e.buffer[i];
        if (v > peak) peak = v;
      }
      target = peak > 0.0005 ? Math.min(1, Math.max(0, (20 * Math.log10(peak) + DB_FLOOR) / DB_FLOOR)) : 0;
    }
    // Ataque inmediato, caída suave (como un medidor real)
    e.level = target >= e.level ? target : Math.max(target, e.level - dt * 1.8);
    if (e.level < 0.004) e.level = 0;
    if (e.level > 0) anyMoving = true;
    if (e.fill) e.fill.style.transform = `${e.axis === "x" ? "scaleX" : "scaleY"}(${e.level.toFixed(3)})`;
    if (e.root && !reduced) {
      const sig = Math.round(e.level * 20) / 20;
      if (sig !== e.shownSig) {
        e.shownSig = sig;
        e.root.style.setProperty("--sig", String(sig));
      }
    }
  }
  if (active || anyMoving) frame = requestAnimationFrame(tick);
}
