import { useEffect, useRef } from "react";
import { DEAD_ZONE } from "./gesture";

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

/** Pausa (ms) con el dedo quieto sobre la barra para "armar" el arrastre táctil. */
const ARM_MS = 200;

type TouchGesture = { id: number; x: number; y: number; startValue: number; timer: number; state: "waiting" | "armed" | "scroll" };

/**
 * Paneo compacto: arrastra la barra; toca el valor para volver al centro.
 * Con el dedo, el paneo se mueve en horizontal, igual que la lista de canales; para no confundirlos, el arrastre táctil se arma
 * manteniendo el dedo quieto ~200 ms sobre la barra. Un deslizamiento inmediato desplaza la lista y nunca cambia el valor.
 */
export default function Pan({ value, onChange, label }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<TouchGesture | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  // Una vez armado, el navegador no debe empezar a desplazar la lista (touchmove no pasivo; el primero aún es cancelable).
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const block = (event: TouchEvent) => { if (gesture.current?.state === "armed" && event.cancelable) event.preventDefault(); };
    bar.addEventListener("touchmove", block, { passive: false });
    return () => bar.removeEventListener("touchmove", block);
  }, []);

  function endTouch(bar: HTMLElement) {
    if (gesture.current) window.clearTimeout(gesture.current.timer);
    gesture.current = null;
    bar.classList.remove("is-dragging");
  }

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
        onPointerDown={(event) => {
          const bar = event.currentTarget;
          if (event.pointerType === "touch") {
            const pointerId = event.pointerId;
            const g: TouchGesture = { id: pointerId, x: event.clientX, y: event.clientY, startValue: valueRef.current, timer: 0, state: "waiting" };
            g.timer = window.setTimeout(() => {
              if (gesture.current !== g || g.state !== "waiting") return;
              g.state = "armed";
              bar.setPointerCapture(pointerId);
              bar.classList.add("is-dragging");
            }, ARM_MS);
            gesture.current = g;
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
            // Se movió antes de armarse: es un deslizamiento (desplaza la lista), no un ajuste de paneo.
            if (g.state === "waiting" && Math.max(Math.abs(dx), Math.abs(event.clientY - g.y)) >= DEAD_ZONE) {
              window.clearTimeout(g.timer);
              g.state = "scroll";
            }
            if (g.state === "armed") {
              const rect = event.currentTarget.getBoundingClientRect();
              let next = g.startValue + (dx / rect.width) * 2; // relativo: sin salto al armarse
              if (Math.abs(next) < 0.08) next = 0; // imán al centro
              onChange(Math.round(clamp(next) * 50) / 50);
            }
            return;
          }
          if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event.clientX);
        }}
        onPointerUp={(event) => (gesture.current?.id === event.pointerId ? endTouch(event.currentTarget) : event.currentTarget.classList.remove("is-dragging"))}
        onPointerCancel={(event) => (gesture.current?.id === event.pointerId ? endTouch(event.currentTarget) : event.currentTarget.classList.remove("is-dragging"))}
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
        <div className="pan-thumb" style={{ left: `${position}%` }}><output className="pan-value" aria-hidden="true">{panText(value)}</output></div>
      </div>
    </div>
  );
}
