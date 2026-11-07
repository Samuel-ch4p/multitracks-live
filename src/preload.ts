/** Ajuste «Precargar siguiente canción» (activado por defecto). Guardado en localStorage; la app lo lee en vivo. */
const KEY = "crescendo.precargar.v1";
const listeners = new Set<() => void>();

export function getPreload(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}

export function setPreload(on: boolean) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* sin almacenamiento */ }
  listeners.forEach((listener) => listener());
}

export function subscribePreload(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
