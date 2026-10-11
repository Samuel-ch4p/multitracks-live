import { useRef } from "react";

type Props = {
  value: number; // -1 (izquierda) .. 1 (derecha)
  onChange: (value: number) => void;
  label: string;
};

function panText(pan: number) {
  if (pan === 0) return "C";
  return pan < 0 ? `${Math.round(Math.abs(pan) * 100)}L` : `${Math.round(pan * 100)}R`;
}

const clamp = (n: number) => Math.min(1, Math.max(-1, n));

/** Paneo compacto: arrastra la barra; toca el valor para volver al centro. */
export default function Pan({ value, onChange, label }: Props) {
  const barRef = useRef<HTMLDivElement>(null);

  function fromPointer(clientX: number) {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    let next = ((clientX - rect.left) / rect.width) * 2 - 1;
    if (Math.abs(next) < 0.08) next = 0; // imán al centro
    onChange(Math.round(clamp(next) * 50) / 50);
  }

  const position = ((value + 1) / 2) * 100;

  return (
    <div className="pan">
      <button className="pan-readout" onClick={() => onChange(0)} aria-label={`${label}: centrar`} title="Tocar para centrar">
        <span className="pan-word">PAN</span>
        <b>{panText(value)}</b>
      </button>
      <div
        className="pan-bar"
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          fromPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event.clientX);
        }}
        onDoubleClick={() => onChange(0)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowDown") onChange(clamp(Math.round((value - 0.1) * 50) / 50));
          else if (event.key === "ArrowRight" || event.key === "ArrowUp") onChange(clamp(Math.round((value + 0.1) * 50) / 50));
          else if (event.key === "Home") onChange(0);
          else return;
          event.preventDefault();
        }}
      >
        <div className="pan-track" />
        <div className="pan-center" />
        <div
          className="pan-fill"
          style={{ left: `${Math.min(50, position)}%`, width: `${Math.abs(position - 50)}%` }}
        />
        <div className="pan-thumb" style={{ left: `${position}%` }} />
      </div>
    </div>
  );
}
