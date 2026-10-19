import { useCallback, useEffect, useRef } from "react";

type Props = {
  peaks: Float32Array | null; // valores 0..1
  progress: number; // 0..1, se actualiza poco a poco (sirve en pausa y para accesibilidad)
  playing: boolean;
  getProgress: () => number; // lectura en vivo (0..1): la barra la consulta en cada fotograma mientras suena
  loading: boolean;
  onSeek: (fraction: number) => void;
  disabled?: boolean;
};

const BAR = 6;
const GAP = 4;

/**
 * La forma de onda se dibuja una sola vez (al cambiar la canción o el tamaño) en dos capas: una apagada y otra
 * encendida. Mientras suena solo se mueve una variable CSS (--p) en cada fotograma: la capa encendida se recorta
 * y la línea se desplaza con transform, sin volver a pintar nada ni tocar React.
 */
export default function Waveform({ peaks, progress, playing, getProgress, loading, onSeek, disabled }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const playedRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(playing);
  const dragRef = useRef<number | null>(null); // fracción bajo el dedo mientras se arrastra (null = sin arrastre)
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const draw = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (!width || !height) return;

    const mid = height / 2;
    const bars = Math.floor(width / (BAR + GAP));
    const amps: number[] = [];
    for (let i = 0; i < bars; i++) {
      let amp = 0.04;
      if (peaks && peaks.length) {
        const from = Math.floor((i / bars) * peaks.length);
        const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * peaks.length));
        let max = 0;
        for (let j = from; j < to; j++) max = Math.max(max, peaks[j]);
        amp = Math.max(0.03, max);
      }
      amps.push(amp);
    }

    const paint = (canvas: HTMLCanvasElement | null, top: string, bottom: string, alpha: number) => {
      if (!canvas) return;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.globalAlpha = alpha;
      for (let i = 0; i < bars; i++) {
        const x = i * (BAR + GAP);
        const h = Math.max(2, amps[i] * (height - 14));
        const grad = ctx.createLinearGradient(0, mid - h / 2, 0, mid + h / 2);
        grad.addColorStop(0, top);
        grad.addColorStop(1, bottom);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, mid - h / 2, BAR, h, 2);
        ctx.fill();
      }
    };
    paint(baseRef.current, "#c4dfeb", "#4a778f", 0.72);
    paint(playedRef.current, "#bfeafb", "#4d9dff", 1);
  }, [peaks]);

  useEffect(() => {
    draw();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw]);

  const apply = useCallback((value: number) => {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
    wrapRef.current?.style.setProperty("--p", clamped.toFixed(5));
  }, []);

  // Mientras suena: una lectura por fotograma (a la frecuencia de la pantalla).
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (dragRef.current === null) apply(getProgress());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, getProgress, apply]);

  // En pausa (o al saltar a otro punto) la posición viene del estado.
  useEffect(() => {
    if (!playingRef.current) apply(progress);
  }, [progress, apply]);

  function fractionAt(clientX: number) {
    const wrap = wrapRef.current;
    if (!wrap) return 0;
    const rect = wrap.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  return (
    <div
      className={`waveform ${disabled ? "is-disabled" : ""}`}
      ref={wrapRef}
      role="slider"
      aria-label="Posición de la canción"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={disabled ? -1 : 0}
      // Se puede arrastrar: la barra sigue al dedo y el audio salta una sola vez al soltar (mover el audio en cada pixel lo trabaría).
      onPointerDown={(event) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = fractionAt(event.clientX);
        apply(dragRef.current);
      }}
      onPointerMove={(event) => {
        if (dragRef.current === null) return;
        dragRef.current = fractionAt(event.clientX);
        apply(dragRef.current);
      }}
      onPointerUp={(event) => {
        const target = dragRef.current;
        if (target === null) return;
        dragRef.current = null;
        onSeek(fractionAt(event.clientX));
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        apply(playingRef.current ? getProgress() : progress);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "ArrowRight") onSeek(Math.min(1, progress + 0.01));
        else if (event.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.01));
        else return;
        event.preventDefault();
      }}
    >
      <canvas className="wave-base" ref={baseRef} />
      <canvas className="wave-played" ref={playedRef} />
      {(peaks || progress > 0) && <div className="wave-head" aria-hidden="true"><i /></div>}
      {loading && <span className="waveform-hint">Analizando forma de onda…</span>}
      {!loading && !peaks && <span className="waveform-hint">Sin canción cargada</span>}
    </div>
  );
}
