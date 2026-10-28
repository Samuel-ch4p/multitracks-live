import { useSyncExternalStore } from "react";

/**
 * Ajuste "Efectos visuales: Completos / Reducidos".
 * Se guarda en localStorage y se aplica como <html data-fx="full|reduced">; todo el CSS pesado cuelga de ese atributo
 * (ver styles/app.css). "Completos" es el valor por defecto. Además, `prefers-reduced-motion` apaga las animaciones por CSS.
 */
export type FxMode = "full" | "reduced";

const KEY = "crescendo-fx-v1";
const listeners = new Set<() => void>();
let mode: FxMode = "full";

try {
  if (localStorage.getItem(KEY) === "reduced") mode = "reduced";
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
