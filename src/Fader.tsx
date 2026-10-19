import { useRef } from "react";

type Props = {
  value: number; // 0..100
  onChange: (value: number) => void;
  label: string;
  dimmed?: boolean;
};

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/** Fader vertical con puntero (táctil y mouse) y teclado. */
export default function Fader({ value, onChange, label, dimmed }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  // Con el dedo, tocar no mueve el fader hasta que el gesto sea claramente vertical: así se puede deslizar el mezclador de lado
  // por encima de los faders sin cambiarles el volumen (con el mouse sigue siendo inmediato).
  const gesture = useRef<{ id: number; x: number; y: number; time: number; engaged: boolean } | null>(null);

  function fromPointer(clientY: number) {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    onChange(Math.round(clamp((1 - (clientY - rect.top) / rect.height) * 100)));
  }

  return (
    <div
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
          gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), engaged: false };
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        fromPointer(event.clientY);
      }}
      onPointerMove={(event) => {
        const g = gesture.current;
        if (g && g.id === event.pointerId) {
          if (!g.engaged) {
            const dx = Math.abs(event.clientX - g.x);
            const dy = Math.abs(event.clientY - g.y);
            if (dy < 8 || dy <= dx) return;
            g.engaged = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          fromPointer(event.clientY);
          return;
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event.clientY);
      }}
      onPointerUp={(event) => {
        const g = gesture.current;
        gesture.current = null;
        // Toque corto y quieto: salta a esa altura.
        if (g && g.id === event.pointerId && !g.engaged && performance.now() - g.time < 300
          && Math.abs(event.clientX - g.x) < 6 && Math.abs(event.clientY - g.y) < 6) fromPointer(event.clientY);
      }}
      onPointerCancel={() => { gesture.current = null; }}
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
      <div className="fader-scale" aria-hidden="true">
        {Array.from({ length: 11 }, (_, i) => <i key={i} className={i % 5 === 0 ? "major" : ""} />)}
      </div>
      <div className="fader-rail" ref={railRef}>
        <div className="fader-groove" />
        <div className="fader-fill" style={{ height: `${value}%` }} />
        <div className="fader-cap" style={{ bottom: `${value}%` }}><i /></div>
      </div>
    </div>
  );
}
