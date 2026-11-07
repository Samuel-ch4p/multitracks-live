import { useSyncExternalStore } from "react";

/**
 * "Modo búsqueda": mientras el campo de búsqueda de la Biblioteca tiene el foco (teclado abierto), la pantalla prioriza la lista
 * de resultados (ver .app[data-searching] en styles/library.css). El campo lo enciende y apaga; App solo lo lee.
 */
let active = false;
const listeners = new Set<() => void>();

export function setSearchMode(next: boolean) {
  if (active === next) return;
  active = next;
  listeners.forEach((listener) => listener());
}

export const getSearchMode = () => active;

export function useSearchMode(): boolean {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getSearchMode);
}
