/**
 * Bloqueo de eje para los controles táctiles del mezclador. La lista de canales se desplaza en horizontal con el navegador
 * (touch-action: pan-x), así que un control nunca debe cambiar su valor por un deslizamiento horizontal.
 */

/** Zona muerta (px): hasta que el dedo se mueve esto no se decide nada. */
export const DEAD_ZONE = 8;

export type Axis = "pending" | "vertical" | "horizontal";

/** Eje del gesto según el movimiento desde el toque inicial. "pending" mientras siga dentro de la zona muerta. */
export function lockAxis(dx: number, dy: number): Axis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < DEAD_ZONE) return "pending";
  return ax > ay ? "horizontal" : "vertical";
}
