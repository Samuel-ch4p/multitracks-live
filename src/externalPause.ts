/**
 * Pausas que no pidió el usuario (llamada entrante, alarma, nota de voz de otra app, audífonos desconectados, AudioContext suspendido).
 * Android/el WebView pausa los elementos de audio por su cuenta; si la app no se entera, la interfaz sigue diciendo «En vivo» y el
 * primer toque en Play PAUSA en vez de reanudar. Aquí solo están las reglas puras (se prueban en tools/verify-external-pause.ts).
 */

export type PauseSnapshot = {
  /** La app cree que está sonando. */
  playing: boolean;
  /** La app está haciendo una operación propia (Play, Detener, mover la posición) que pausa pistas a propósito. */
  busy: boolean;
  /** La pista sigue pausada un momento después del evento (si la app la reanudó, por ejemplo tras mover la posición, no cuenta). */
  stillPaused: boolean;
  /** La pista terminó (las pistas cortas terminan antes que la canción: eso no es una pausa externa). */
  ended: boolean;
  /** La pista sigue en el mezclador (una pista quitada con la × se pausa a propósito). */
  inMixer: boolean;
};

/** ¿Esta pausa vino de fuera de la app? */
export function isExternalPause(s: PauseSnapshot): boolean {
  return s.playing && !s.busy && s.stillPaused && !s.ended && s.inMixer;
}

/** ¿Un cambio de estado del AudioContext mientras suena significa que el sistema cortó el audio? */
export function contextInterrupted(state: string, playing: boolean): boolean {
  return playing && (state === "suspended" || state === "interrupted");
}

/** Espera antes de juzgar una pausa (ms): deja terminar las operaciones propias que pausan y reanudan en seguida. */
export const EXTERNAL_PAUSE_SETTLE_MS = 250;

export const EXTERNAL_PAUSE_MESSAGE = "Se pausó por otra app o por los audífonos. Toca Play para continuar.";
