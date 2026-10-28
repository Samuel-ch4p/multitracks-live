import { useEffect, useRef } from "react";
import { useProgress } from "./clock";

type Props = {
  playing: boolean;
  getProgress: () => number; // lectura en vivo mientras suena
  onSeek: (fraction: number) => void;
  disabled?: boolean;
};

/**
 * Barra de progreso arrastrable del reproductor ampliado. Mientras suena se mueve con requestAnimationFrame escribiendo una
 * variable CSS (sin re-renders). Igual que la forma de onda: al arrastrar sigue al dedo y el audio salta una sola vez al soltar.
 */
export default function ScrubBar({ playing, getProgress, onSeek, disabled }: Props) {
  const progress = useProgress(); // 0..1; solo este componente se repinta cuando cambia el segundo
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const apply = (value: number) => ref.current?.style.setProperty("--p", Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)).toFixed(5));

  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      if (drag.current === null) apply(getProgress());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, getProgress]);

  useEffect(() => { if (!playingRef.current && drag.current === null) apply(progress); }, [progress]);

  const fractionAt = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
  };

  return (
    <div
      ref={ref}
      className={`scrub ${disabled ? "is-disabled" : ""}`}
      role="slider"
      aria-label="Posición de la canción"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      onPointerDown={(event) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = fractionAt(event.clientX);
        apply(drag.current);
      }}
      onPointerMove={(event) => {
        if (drag.current === null) return;
        drag.current = fractionAt(event.clientX);
        apply(drag.current);
      }}
      onPointerUp={(event) => {
        if (drag.current === null) return;
        drag.current = null;
        onSeek(fractionAt(event.clientX));
      }}
      onPointerCancel={() => { drag.current = null; apply(playingRef.current ? getProgress() : progress); }}
    >
      <span className="scrub-fill" />
      <i className="scrub-knob" />
    </div>
  );
}
