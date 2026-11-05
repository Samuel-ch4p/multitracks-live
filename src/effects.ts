import { useSyncExternalStore } from "react";

/**
 * Ajuste "Animaciones: Completas / Reducidas / Desactivadas".
 * Se guarda en localStorage y se aplica como <html data-fx="full|reduced|off">; todo el CSS pesado cuelga de ese atributo
 * (ver styles/app.css). "Completos" es el valor por defecto. Además, `prefers-reduced-motion` apaga las animaciones por CSS.
 */
export type FxMode = "full" | "reduced" | "off";

/** Reducidas y Desactivadas comparten los ahorros de rendimiento (medidores a menos fotogramas, sin brillos). */
export const isLightFx = () => mode !== "full";

const KEY = "crescendo-fx-v1";
const listeners = new Set<() => void>();
let mode: FxMode = "full";

try {
  const saved = localStorage.getItem(KEY);
  if (saved === "reduced" || saved === "off") mode = saved;
} catch { /* sin almacenamiento: queda en Completos */ }

export function applyFx() {
  document.documentElement.dataset.fx = mode;
}

export function setFx(next: FxMode) {
  mode = next;
  applyFx();
  try { localStorage.setItem(KEY, next); } catch { /* solo vale para esta sesión */ }
  listeners.forEach((listener) => listener());
}

export const getFx = () => mode;

export function useFx(): [FxMode, (next: FxMode) => void] {
  const current = useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getFx,
  );
  return [current, setFx];
}
