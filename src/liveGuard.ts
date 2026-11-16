/**
 * Guardia contra toques accidentales mientras suena una canción (Detener, Reiniciar y CAMBIAR DE CANCIÓN).
 *
 * CÓMO AJUSTAR LA FRICCIÓN
 *  · `holdMs`: cuánto hay que mantener pulsado (ms). Más alto = más difícil cambiar por accidente, pero más lento a propósito.
 *    Si se cambia, cambiar también la duración de la barra en src/styles/mixer.css (`.hold-btn.is-holding::before`, 450ms).
 *  · `switchSong`: false = cambiar de canción vuelve a ser inmediato aunque suene (como en la 1.0). Detener y Reiniciar siguen protegidos.
 * Con la canción detenida o en pausa, todo actúa con un solo toque. El teclado y los lectores de pantalla actúan siempre con una pulsación.
 */
export const LIVE_GUARD = {
  holdMs: 450,
  switchSong: true,
} as const;

/** ¿Cambiar de la canción activa a `targetId` exige mantener pulsado? Solo si suena y es OTRA canción. */
export function switchNeedsHold(playing: boolean, activeId: number | null, targetId: number, guard: { switchSong: boolean } = LIVE_GUARD): boolean {
  return guard.switchSong && playing && targetId !== activeId;
}

/** Mensaje para un toque corto sobre una acción protegida. */
export const SHORT_TAP_SWITCH = "Mantén pulsado para cambiar de canción";
