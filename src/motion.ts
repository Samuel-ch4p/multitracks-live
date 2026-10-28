import { useSyncExternalStore } from "react";

/**
 * Movimiento reducido del sistema. Si el sistema lo pide, se respeta por defecto (<html data-motion="reduce">), pero el usuario
 * puede decidir lo contrario en Ajustes. El valor se guarda en localStorage ("respect" | "ignore").
 */
const MOTION_KEY = "crescendo-motion-v1";
const motionQuery = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
let respectSystem = true;
const listeners = new Set<() => void>();
let version = 0;

try {
  if (localStorage.getItem(MOTION_KEY) === "ignore") respectSystem = false;
} catch { /* sin almacenamiento: se respeta al sistema */ }

export function applyMotion() {
  const reduce = !!motionQuery?.matches && respectSystem;
  document.documentElement.dataset.motion = reduce ? "reduce" : "full";
  version++;
  listeners.forEach((listener) => listener());
}

motionQuery?.addEventListener("change", applyMotion);

export function setRespectSystemMotion(value: boolean) {
  respectSystem = value;
  try { localStorage.setItem(MOTION_KEY, value ? "respect" : "ignore"); } catch { /* solo vale para esta sesión */ }
  applyMotion();
}

/** systemReduce: el sistema pidió menos animaciones · respect: el usuario decidió respetarlo. */
export function useMotion(): { systemReduce: boolean; respect: boolean } {
  useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version);
  return { systemReduce: !!motionQuery?.matches, respect: respectSystem };
}
