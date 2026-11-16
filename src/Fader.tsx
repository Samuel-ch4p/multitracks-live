import { useRef } from "react";
import { FINE_HOLD_MS, FaderDrag, faderAxis } from "./faderGesture";

type Props = {
  value: number; // 0..100
  onChange: (value: number) => void;
  label: string;
  dimmed?: boolean;
};

const clamp = (n: number) => Math.min(100, Math.max(0, n));
/** setPointerCapture lanza un error si el puntero ya no está activo (dedo levantado entre eventos): nunca debe romper el gesto. */
const capture = (el: Element, id: number) => { try { el.setPointerCapture(id); } catch { /* puntero ya inactivo */ } };

type TouchGesture = {
  id: number;
  x: number;
  y: number;
  /** El dedo empezó en la perilla (zona .fader-hit, touch-action: none): cualquier dirección mueve el fader. */
  onCap: boolean;
  downAt: number;
  /** pending: aún dentro de la zona muerta · drag: mueve el fader · scroll: gesto horizontal en el carril, no se toca nada. */
  mode: "pending" | "drag" | "scroll";
  drag: FaderDrag | null;
};

/**
 * Fader vertical con puntero (táctil y mouse) y teclado. Cabeza en barra vertical sobre un carril delgado; el número aparece al arrastrar.
 * Con el dedo (reglas en faderGesture.ts):
 *  · desde la perilla (zona de 44 × 44 px) el fader se mueve en cualquier dirección, sin confundirse con desplazar la lista;
 *  · desde el resto del carril, solo un gesto claramente horizontal desplaza la lista; lo demás mueve el fader;
 *  · el movimiento es relativo (sin saltos) y apartar el dedo en horizontal o mantenerlo quieto antes de mover activa el MODO FINO (×0,25);
 *  · un toque corto no cambia el volumen (doble toque: 80).
 */
export default function Fader({ value, onChange, label, dimmed }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<TouchGesture | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  // Mientras se arrastra, la cabeza sigue al dedo sin retraso; al soltar o al cambiar por toque/teclado se desliza con inercia (CSS).
  const setDragging = (on: boolean) => rootRef.current?.classList.toggle("is-dragging", on);
  const setFine = (on: boolean) => rootRef.current?.classList.toggle("is-fine", on);

  function railHeight() {
    return railRef.current?.getBoundingClientRect().height || 1;
  }

  function fromPointer(clientY: number) {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    onChange(Math.round(clamp((1 - (clientY - rect.top) / rect.height) * 100)));
  }

  function endTouch() {
    gesture.current = null;
    setDragging(false);
    setFine(false);
  }

  return (
    <div
      ref={rootRef}
      className={`fader ${dimmed ? "is-dimmed" : ""}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") {
          const onCap = !!(event.target as Element).closest(".fader-hit");
          gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, onCap, downAt: event.timeStamp, mode: "pending", drag: null };
          if (onCap) capture(event.currentTarget, event.pointerId);
          return;
        }
        capture(event.currentTarget, event.pointerId);
        setDragging(true);
        fromPointer(event.clientY);
      }}
      onPointerMove={(event) => {
        const g = gesture.current;
        if (g && g.id === event.pointerId) {
          if (g.mode === "scroll") return;
          if (g.mode === "pending") {
            const axis = faderAxis(event.clientX - g.x, event.clientY - g.y, g.onCap);
            if (axis === "pending") return;
            if (axis === "horizontal") { g.mode = "scroll"; return; }
            g.mode = "drag";
            // El arrastre parte de aquí (la cabeza no salta). Si el dedo estuvo quieto antes de moverse, empieza en modo fino.
            g.drag = new FaderDrag(event.clientX, event.clientY, valueRef.current, railHeight(), event.timeStamp - g.downAt >= FINE_HOLD_MS);
            if (!g.onCap) capture(event.currentTarget, event.pointerId);
            setDragging(true);
            setFine(g.drag.fine);
            return;
          }
          const next = g.drag?.move(event.clientX, event.clientY);
          setFine(!!g.drag?.fine);
          if (next != null) onChange(next);
          return;
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event.clientY);
      }}
      onPointerUp={(event) => {
        if (gesture.current?.id === event.pointerId) endTouch();
        else setDragging(false);
      }}
      onPointerCancel={endTouch}
      onLostPointerCapture={() => { setDragging(false); setFine(false); }}
      onDoubleClick={() => onChange(80)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 10 : 2;
        if (event.key === "ArrowUp" || event.key === "ArrowRight") onChange(clamp(value + step));
        else if (event.key === "ArrowDown" || event.key === "ArrowLeft") onChange(clamp(value - step));
        else if (event.key === "Home") onChange(100);
        else if (event.key === "End") onChange(0);
        else return;
        event.preventDefault();
      }}
    >
      <div className="fader-rail" ref={railRef}>
        <div className="fader-groove" />
        <div className="fader-fill" style={{ height: `${value}%` }} />
        <div className="fader-cap" style={{ bottom: `${value}%` }}>
          <i />
          <output className="fader-value" aria-hidden="true">{value}</output>
          <span className="fader-hit" />
        </div>
      </div>
    </div>
  );
}
