/**
 * Vigila los fotogramas por segundo mientras suena la canción. Si bajan de SLOW_FPS durante SLOW_SECONDS seguidos avisa UNA vez
 * (onSlow) para proponer "Efectos visuales: Reducidos". Nunca cambia nada por sí solo. Solo cuenta fotogramas: casi no cuesta.
 */
const SLOW_FPS = 40;
const SLOW_SECONDS = 5;

type Snapshot = { fps: number; min5s: number };

let frame = 0;
let windowStart = 0;
let frames = 0;
let current = 60;
let slowSince: number | null = null;
let onSlowCb: (() => void) | null = null;
const history: number[] = [];

function tick(now: number) {
  frames++;
  if (now - windowStart >= 1000) {
    current = Math.round((frames * 1000) / (now - windowStart));
    history.push(current);
    if (history.length > 5) history.shift();
    frames = 0;
    windowStart = now;
    if (current < SLOW_FPS) {
      slowSince ??= now;
      if (now - slowSince >= SLOW_SECONDS * 1000 && onSlowCb) {
        const cb = onSlowCb;
        onSlowCb = null; // solo una vez por activación
        cb();
      }
    } else slowSince = null;
  }
  frame = requestAnimationFrame(tick);
}

/** Empieza a medir (al sonar). `onSlow` se llama como mucho una vez si hay fotogramas lentos sostenidos. */
export function startFpsWatch(onSlow: (() => void) | null) {
  onSlowCb = onSlow;
  if (frame) return;
  windowStart = performance.now();
  frames = 0;
  slowSince = null;
  frame = requestAnimationFrame(tick);
}

export function stopFpsWatch() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  slowSince = null;
  history.length = 0;
}

export function fpsSnapshot(): Snapshot | null {
  if (!frame) return null;
  return { fps: current, min5s: history.length ? Math.min(...history) : current };
}
