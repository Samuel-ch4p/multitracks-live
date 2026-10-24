/**
 * Ley de paneo con potencia constante para pistas de cualquier tipo.
 *
 * Cada pista entra a la mezcla como dos canales (L, R) y sale por una matriz de 4 ganancias:
 *   salidaL = LL·L + RL·R      salidaR = LR·L + RR·R
 *
 * - Pista mono (o estéreo con el mismo audio en los dos lados, o con un solo lado con sonido, p. ej. una Guía grabada
 *   solo en L o solo en R): se toma UN canal c y sale por el paneo seno/coseno: gL = cos θ, gR = sin θ, θ = (pan+1)·π/4.
 *   gL² + gR² = 1 en todo el recorrido → la energía total no cambia al panear; en el centro cada lado vale 0,707
 *   (igual que el StereoPannerNode que se usaba antes con una pista mono).
 * - Pista estéreo real: balance con compensación, gL = √2·cos θ sobre L y gR = √2·sin θ sobre R. En el centro vale 1
 *   (pasa tal cual, como antes). Al panear no se mezclan los dos lados (el StereoPannerNode los sumaba, y el contenido
 *   amplio o en contrafase perdía volumen); el √2 repone la energía del lado que se atenúa.
 */
export type Layout = "mono" | "left" | "right" | "stereo";

export type PanTaps = [LL: number, LR: number, RL: number, RR: number];

export function panTaps(pan: number, layout: Layout): PanTaps {
  const p = Number.isFinite(pan) ? Math.min(1, Math.max(-1, pan)) : 0;
  const theta = ((p + 1) * Math.PI) / 4;
  const gl = Math.cos(theta);
  const gr = Math.sin(theta);
  if (layout === "stereo") return [Math.SQRT2 * gl, 0, 0, Math.SQRT2 * gr];
  if (layout === "right") return [0, 0, gl, gr];
  return [gl, gr, 0, 0]; // "mono" y "left": se usa el canal izquierdo
}
