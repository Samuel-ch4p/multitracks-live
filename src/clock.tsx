import { useSyncExternalStore } from "react";

/**
 * Reloj de reproducción fuera de App: el tiempo cambia cada segundo y solo debe repintar los textos de tiempo,
 * nunca el mezclador ni el resto de la pantalla. App escribe aquí (setClock); los componentes de abajo lo leen.
 */
type ClockState = { time: number; duration: number };

let state: ClockState = { time: 0, duration: 0 };
const listeners = new Set<() => void>();

export function setClock(time: number, duration: number) {
  if (state.time === time && state.duration === duration) return;
  state = { time, duration };
  listeners.forEach((listener) => listener());
}

export const getClock = () => state;

export function useClock(): ClockState {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getClock);
}

/** Fracción 0..1 recorrida de la canción. */
export function useProgress(): number {
  const { time, duration } = useClock();
  return duration > 0 ? Math.min(1, time / duration) : 0;
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

export function shortTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/** Reloj de la barra superior. */
export function HeaderClock() {
  const { time, duration } = useClock();
  return (
    <div className="clock">
      <strong>{formatTime(time)}</strong>
      <span>{shortTime(time)} / {shortTime(duration)}</span>
    </div>
  );
}

/** Tiempo transcurrido (por ejemplo "1:23"). */
export function ElapsedText() {
  return <span>{shortTime(useClock().time)}</span>;
}

/** Tiempo restante (por ejemplo "-3:54"). */
export function RemainingText() {
  const { time, duration } = useClock();
  return <span>-{shortTime(Math.max(0, duration - time))}</span>;
}
