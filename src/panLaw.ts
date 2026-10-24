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
 * - Pista estéreo real: en el centro pasa tal cual. Al panear hacia un lado, el canal contrario se "dobla" hacia ese lado:
 *   con t = |pan| (0..1), lado destino D y contrario O:  D ← cos(tπ/4)·D + sin(tπ/4)·O,  O ← cos(tπ/2)·O.
 *   A paneo total todo sale por un solo lado como 0,707·(L + R): no se pierde nada del canal contrario y, con contenido
 *   parecido en ambos lados (lo normal), el volumen percibido es el mismo que en el centro. (Con dos lados totalmente
 *   distintos, sumarlos suena ~3 dB más bajo que en el centro: es inherente a sumar en mono.)
 */
export type Layout = "mono" | "left" | "right" | "stereo";

export type PanTaps = [LL: number, LR: number, RL: number, RR: number];

export function panTaps(pan: number, layout: Layout): PanTaps {
  const p = Number.isFinite(pan) ? Math.min(1, Math.max(-1, pan)) : 0;
  const theta = ((p + 1) * Math.PI) / 4;
  const gl = Math.cos(theta);
  const gr = Math.sin(theta);
  if (layout === "stereo") {
    const t = Math.abs(p);
    const keep = Math.cos((t * Math.PI) / 4);
    const fold = Math.sin((t * Math.PI) / 4);
    const fade = Math.cos((t * Math.PI) / 2);
    return p <= 0 ? [keep, 0, fold, fade] : [fade, fold, 0, keep]; // [LL, LR, RL, RR]
  }
  if (layout === "right") return [0, 0, gl, gr];
  return [gl, gr, 0, 0]; // "mono" y "left": se usa el canal izquierdo
}
