import { useCallback, useEffect, useRef } from "react";

type Props = {
  peaks: Float32Array | null; // valores 0..1
  progress: number; // 0..1
  loading: boolean;
  onSeek: (fraction: number) => void;
  disabled?: boolean;
};

export default function Waveform({ peaks, progress, loading, onSeek, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (!width || !height) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const mid = height / 2;
    const barWidth = 6;
    const gap = 4;
    const bars = Math.floor(width / (barWidth + gap));
    const playedX = progress * width;

    for (let i = 0; i < bars; i++) {
      const x = i * (barWidth + gap);
      let amp = 0.04;
      if (peaks && peaks.length) {
        const from = Math.floor((i / bars) * peaks.length);
        const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * peaks.length));
        let max = 0;
        for (let j = from; j < to; j++) max = Math.max(max, peaks[j]);
        amp = Math.max(0.03, max);
      }
      const h = Math.max(2, amp * (height - 14));
      const grad = ctx.createLinearGradient(0, mid - h / 2, 0, mid + h / 2);
      if (x < playedX) { grad.addColorStop(0, "#bfeafb"); grad.addColorStop(1, "#4d9dff"); }
      else { grad.addColorStop(0, "#c4dfeb"); grad.addColorStop(1, "#4a778f"); }
      ctx.globalAlpha = x < playedX ? 1 : 0.72;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, mid - h / 2, barWidth, h, 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // línea de reproducción
    if (peaks || progress > 0) {
      const x = Math.min(width - 2, Math.max(0, playedX - 1));
      ctx.fillStyle = "#eaf3ff";
      ctx.shadowColor = "#69d9f5";
      ctx.shadowBlur = 8;
      ctx.fillRect(x, 0, 2, height);
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(x - 5, 0);
      ctx.lineTo(x + 7, 0);
      ctx.lineTo(x + 1, 7);
      ctx.closePath();
      ctx.fill();
    }
  }, [peaks, progress]);

  useEffect(() => {
    draw();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw]);

  function seekFromPointer(clientX: number) {
    const wrap = wrapRef.current;
    if (!wrap || disabled) return;
    const rect = wrap.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
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
      onPointerDown={(event) => seekFromPointer(event.clientX)}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "ArrowRight") onSeek(Math.min(1, progress + 0.01));
        else if (event.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.01));
        else return;
        event.preventDefault();
      }}
    >
      <canvas ref={canvasRef} />
      {loading && <span className="waveform-hint">Analizando forma de onda…</span>}
      {!loading && !peaks && <span className="waveform-hint">Sin canción cargada</span>}
    </div>
  );
}
