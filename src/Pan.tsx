import { useRef, type CSSProperties } from "react";

/** Desplazamiento mínimo (px) para considerar que el dedo arrastró y no tocó. */
const DEAD_ZONE = 8;

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

/** Radio (mitad del ancho) de la perilla en px; debe coincidir con --pan-r de mixer.css. El centro de la perilla recorre [R, ancho − R]: nunca sobresale del carril. */
const THUMB_R = 13;

type TouchGesture = { id: number; x: number; startValue: number; moved: boolean; fromReadout: boolean };

/**
 * Paneo compacto: arrastra la perilla; toca el valor para volver al centro.
 * Con el dedo, el gesto empieza al tocar la perilla (zona táctil .pan-hit de 44 × 44 px, con touch-action: none) y desde ahí el arrastre mueve el
 * paneo sin mantener presionado ni desplazar la lista. Un toque fuera de la zona no es de la perilla: el navegador desplaza el mezclador (pan-x).
 */
export default function Pan({ value, onChange, label }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<TouchGesture | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  function endTouch(bar: HTMLElement, cancelled: boolean) {
    const g = gesture.current;
    gesture.current = null;
    bar.classList.remove("is-dragging");
    // La zona táctil cubre la parte baja del valor ("C"): un toque ahí, sin arrastrar, equivale a tocar el valor (centrar).
    if (g && !cancelled && !g.moved && g.fromReadout) onChange(0);
  }

  function fromPointer(clientX: number) {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    let next = ((clientX - rect.left - THUMB_R) / Math.max(1, rect.width - 2 * THUMB_R)) * 2 - 1;
    if (Math.abs(next) < 0.08) next = 0; // imán al centro
    onChange(Math.round(clamp(next) * 50) / 50);
  }

  const fraction = (value + 1) / 2; // 0 = extremo izquierdo, 1 = extremo derecho; mixer.css lo convierte en posición contenida

  return (
    <div className="pan">
      <div className="pan-labels">
        <span>L</span>
        <button className="pan-readout" onClick={() => onChange(0)} aria-label={`${label}: centrar`} title="Tocar para centrar">
          {panText(value)}
        </button>
        <span>R</span>
      </div>
      <div
        className="pan-bar"
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        style={{ "--pp": fraction, "--pl": Math.min(0.5, fraction), "--pw": Math.abs(fraction - 0.5) } as CSSProperties}
        onPointerDown={(event) => {
          const bar = event.currentTarget;
          if (event.pointerType === "touch") {
            if (!(event.target as Element).closest(".pan-hit")) return; // fuera de la perilla: deja desplazar el mezclador
            gesture.current = { id: event.pointerId, x: event.clientX, startValue: valueRef.current, moved: false, fromReadout: event.clientY < bar.getBoundingClientRect().top };
            bar.setPointerCapture(event.pointerId);
            bar.classList.add("is-dragging");
            return;
          }
          bar.setPointerCapture(event.pointerId);
          bar.classList.add("is-dragging");
          fromPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          const g = gesture.current;
          if (g && g.id === event.pointerId) {
            const dx = event.clientX - g.x;
            if (Math.abs(dx) >= DEAD_ZONE) g.moved = true;
            const rect = event.currentTarget.getBoundingClientRect();
            let next = g.startValue + (dx / Math.max(1, rect.width - 2 * THUMB_R)) * 2; // relativo: sin salto al tocar
            if (Math.abs(next) < 0.08) next = 0; // imán al centro
            onChange(Math.round(clamp(next) * 50) / 50);
            return;
          }
          if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event.clientX);
        }}
        onPointerUp={(event) => (gesture.current?.id === event.pointerId ? endTouch(event.currentTarget, false) : event.currentTarget.classList.remove("is-dragging"))}
        onPointerCancel={(event) => (gesture.current?.id === event.pointerId ? endTouch(event.currentTarget, true) : event.currentTarget.classList.remove("is-dragging"))}
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
        <div className="pan-fill" />
        <div className="pan-thumb"><output className="pan-value" aria-hidden="true">{panText(value)}</output><span className="pan-hit" /></div>
      </div>
    </div>
  );
}
