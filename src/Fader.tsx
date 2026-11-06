import { useRef } from "react";
import { lockAxis } from "./gesture";

type Props = {
  value: number; // 0..100
  onChange: (value: number) => void;
  label: string;
  dimmed?: boolean;
};

const clamp = (n: number) => Math.min(100, Math.max(0, n));

type TouchGesture = {
  id: number;
  x: number;
  y: number;
  /** pending: aún dentro de la zona muerta · drag: eje vertical fijado, mueve el fader · scroll: eje horizontal, no se toca nada. */
  mode: "pending" | "drag" | "scroll";
  originY: number;
  originValue: number;
};

/**
 * Fader vertical con puntero (táctil y mouse) y teclado. Cabeza en barra vertical sobre un carril delgado; el número aparece al arrastrar.
 * Con el dedo: touch-action pan-x (la lista de canales sigue desplazándose) y bloqueo de eje: tras una zona muerta de 8 px, si el
 * movimiento es horizontal no se cambia ningún valor; si es vertical, el fader se mueve en relativo (sin saltos) hasta soltar.
 * Un toque corto con el dedo no cambia el volumen (doble toque: 80).
 */
export default function Fader({ value, onChange, label, dimmed }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<TouchGesture | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  // Mientras se arrastra, la cabeza sigue al dedo sin retraso; al soltar o al cambiar por toque/teclado se desliza con inercia (CSS).
  const setDragging = (on: boolean) => rootRef.current?.classList.toggle("is-dragging", on);

  function railHeight() {
    return railRef.current?.getBoundingClientRect().height || 1;
  }

  function fromPointer(clientY: number) {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    onChange(Math.round(clamp((1 - (clientY - rect.top) / rect.height) * 100)));
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
          gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, mode: "pending", originY: event.clientY, originValue: valueRef.current };
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        fromPointer(event.clientY);
      }}
      onPointerMove={(event) => {
        const g = gesture.current;
        if (g && g.id === event.pointerId) {
          if (g.mode === "scroll") return;
          if (g.mode === "pending") {
            const axis = lockAxis(event.clientX - g.x, event.clientY - g.y);
            if (axis === "pending") return;
            if (axis === "horizontal") { g.mode = "scroll"; return; }
            g.mode = "drag";
            g.originY = event.clientY; // el arrastre parte de aquí: la cabeza no da un salto al decidirse el eje
            g.originValue = valueRef.current;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
            return;
          }
          onChange(Math.round(clamp(g.originValue + ((g.originY - event.clientY) / railHeight()) * 100)));
          return;
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event.clientY);
      }}
      onPointerUp={(event) => {
        setDragging(false);
        if (gesture.current?.id === event.pointerId) gesture.current = null;
      }}
      onPointerCancel={() => { gesture.current = null; setDragging(false); }}
      onLostPointerCapture={() => setDragging(false)}
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
        </div>
      </div>
    </div>
  );
}
