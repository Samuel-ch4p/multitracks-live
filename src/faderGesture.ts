/**
 * Gesto táctil del fader (reglas puras; se prueban en tools/verify-fader.ts).
 *
 * · Tocar la PERILLA (zona .fader-hit de 44 × 44 px, touch-action: none): el fader es tuyo en cualquier dirección. Un gesto
 *   diagonal ya no se pierde como desplazamiento de la lista.
 * · Tocar el resto del carril (touch-action: pan-x, para poder desplazar el mezclador con el dedo): tras la zona muerta, SOLO un
 *   gesto claramente horizontal (más de 1,5 veces más horizontal que vertical) se deja para desplazar; lo demás mueve el fader.
 *   Antes bastaba con que fuera un poco más horizontal que vertical, y un pulgar en diagonal no movía nada.
 * · MODO FINO (sensibilidad ×0,25): apartar el dedo en horizontal más de FINE_DX px de donde empezó el arrastre, o mantener el dedo
 *   quieto FINE_HOLD_MS antes de empezar a moverlo. Al entrar o salir del modo fino se toma la posición actual como nuevo origen:
 *   el valor nunca salta. Solo se emite un valor entero nuevo cuando cambia (sin temblor).
 */

/** Zona muerta en el carril (px). Antes 8; 6 sigue dejando que el navegador reconozca un desplazamiento horizontal. */
export const FADER_DEAD_ZONE = 6;
/** En la perilla no compite con el desplazamiento: zona muerta mínima (4 px absorbe el temblor de un dedo quieto). */
export const FADER_DEAD_ZONE_CAP = 4;
/** Proporción horizontal/vertical a partir de la cual el gesto en el carril se deja para desplazar la lista. */
export const SCROLL_RATIO = 1.5;
/** Desplazamiento horizontal (px) desde el inicio del arrastre que activa el modo fino. */
export const FINE_DX = 36;
/** Tiempo quieto (ms) antes de mover que activa el modo fino. */
export const FINE_HOLD_MS = 500;
/** Sensibilidad en modo fino (fracción del recorrido normal). */
export const FINE_FACTOR = 0.25;
/** Temblor de un dedo quieto (px): movimientos menores no cambian el número. */
export const JITTER_PX = 1.5;

export type FaderAxis = "pending" | "vertical" | "horizontal";

/** Eje del gesto. En la perilla siempre vertical (el horizontal se usa para el modo fino). */
export function faderAxis(dx: number, dy: number, onCap: boolean): FaderAxis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < (onCap ? FADER_DEAD_ZONE_CAP : FADER_DEAD_ZONE)) return "pending";
  if (onCap) return "vertical";
  return ax > ay * SCROLL_RATIO ? "horizontal" : "vertical";
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/** Arrastre relativo con modo fino. `move` devuelve el valor (entero 0..100) o null si no cambió. */
export class FaderDrag {
  private originX: number;
  private originY: number;
  private originValue: number;
  private exact: number;
  private lastEmitted: number;
  private railPx: number;
  fine: boolean;

  constructor(x: number, y: number, value: number, railPx: number, startFine = false) {
    this.originX = x;
    this.originY = y;
    this.originValue = value;
    this.exact = value;
    this.lastEmitted = Math.round(value);
    this.railPx = Math.max(1, railPx);
    this.fine = startFine;
    this.startedFineByHold = startFine;
  }

  move(x: number, y: number): number | null {
    const wantFine = this.fine ? Math.abs(x - this.originX) > FINE_DX * 0.5 || this.startedFineByHold : Math.abs(x - this.originX) > FINE_DX;
    if (wantFine !== this.fine) {
      // Cambio de sensibilidad: el punto actual pasa a ser el origen (el valor no salta).
      this.originY = y;
      this.originValue = this.exact;
      this.fine = wantFine;
      if (!wantFine) this.startedFineByHold = false;
    }
    const factor = this.fine ? FINE_FACTOR : 1;
    this.exact = clamp(this.originValue + ((this.originY - y) / this.railPx) * 100 * factor);
    // Histéresis (sin temblor): solo cambia el número si el dedo se movió más que el temblor de un dedo quieto (JITTER_PX)
    // y más de ¾ de unidad desde el último valor emitido. En los extremos (0 y 100) se llega siempre.
    const unitsPerPx = (100 * factor) / this.railPx;
    const threshold = Math.max(0.75, JITTER_PX * unitsPerPx);
    const atEdge = this.exact === 0 || this.exact === 100;
    if (!atEdge && Math.abs(this.exact - this.lastEmitted) < threshold) return null;
    const rounded = Math.round(this.exact);
    if (rounded === this.lastEmitted) return null;
    this.lastEmitted = rounded;
    return rounded;
  }

  /** Modo fino por mantener pulsado: dura hasta soltar (salvo que el dedo vuelva y se aparte de nuevo en horizontal). */
  private startedFineByHold = false;
  holdFine() {
    this.fine = true;
    this.startedFineByHold = true;
  }
}
