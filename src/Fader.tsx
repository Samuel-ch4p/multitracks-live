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
        event.currentTarget.setPointerCapture(event.pointerId);
        fromPointer(event.clientY);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event.clientY);
      }}
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
