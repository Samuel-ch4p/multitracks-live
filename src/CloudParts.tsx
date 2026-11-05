import type { CSSProperties, ReactNode } from "react";
import BrandMark from "./BrandMark";

type LoadCardProps = {
  /** Etapa: define el título de la tarjeta. */
  stage: "download" | "extract";
  /** 0..100, o null si no se conoce (barra indeterminada). */
  percent: number | null;
  detail?: string;
  fileName: string;
  /** Mensaje de error: la tarjeta pasa a modo error (con REINTENTAR y CERRAR). */
  error?: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
  onClose?: () => void;
};

/** Tarjeta de progreso de descarga / extracción de una canción. */
export function LoadCard({ stage, percent, detail, fileName, error, onCancel, onRetry, onClose }: LoadCardProps) {
  const title = stage === "download" ? "Descargando canción" : "Preparando pistas";
  if (error) {
    return (
      <div className="load-layer" role="alertdialog" aria-live="assertive" aria-label="No se pudo cargar la canción">
        <div className="load-card is-error">
          <BrandMark />
          <span className="eyebrow">NO SE PUDO CARGAR</span>
          <h2>{fileName || "Multitrack"}</h2>
          <p className="load-error-text">{error}</p>
          <div className="load-actions">
            {onClose && <button className="pill-btn" onClick={onClose}>CERRAR</button>}
            {onRetry && <button className="pill-btn primary" onClick={onRetry}>REINTENTAR</button>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="load-layer" role="status" aria-live="polite">
      <div className="load-card">
        <BrandMark />
        <span className="eyebrow">PREPARANDO MULTITRACK</span>
        <h2>{title}</h2>
        <p>{fileName}</p>
        <div className={`load-progress ${percent === null ? "is-indeterminate" : ""}`} style={{ "--pct": percent === null ? 0 : percent / 100 } as CSSProperties}><span /></div>
        <div className="load-meta"><strong>{percent === null ? "…" : `${percent}%`}</strong><span>{detail || "Conexión segura"}</span></div>
        {onCancel && <div className="load-actions"><button className="pill-btn" onClick={onCancel}>CANCELAR</button></div>}
      </div>
    </div>
  );
}

export function CloudIcon({ name }: { name: "cloud" | "folder" | "archive" | "back" | "refresh" | "search" | "music" | "plus" }) {
  const paths: Record<typeof name, ReactNode> = {
    cloud: <path d="M7 18h11a4 4 0 0 0 .5-8A6.5 6.5 0 0 0 6 8.2 4.9 4.9 0 0 0 7 18Z" />,
    folder: <path d="M3 7.5h7l2-2h9v13H3v-11Z" />,
    archive: <><path d="M5 3h14v5H5V3Z" /><path d="M6 8v13h12V8M10 12h4" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    music: <><path d="M9 18V5l11-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: <><path d="M20 7v5h-5" /><path d="M18.5 16a8 8 0 1 1 1.1-8.1L20 12" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
