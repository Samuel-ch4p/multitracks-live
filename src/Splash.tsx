import { useEffect, useState } from "react";
import BrandMark from "./BrandMark";

type Props = { onDone: () => void };

const SHOW_MS = 3200; // cuándo empieza a desvanecerse
const FADE_MS = 450;

/**
 * Pantalla de inicio animada. El logo está EXACTAMENTE donde Android dibuja el icono de arranque (centro de la pantalla,
 * mismo tamaño) y con el mismo fondo azul marino, así que el paso del sistema a la app no tiene saltos.
 * Los anillos se "encienden" uno tras otro con un trazo de luz; después aparecen el nombre y la barra de carga.
 * Los elementos pesados (atmósfera, partículas) se apagan con "Efectos visuales: Reducidos".
 */
export default function Splash({ onDone }: Props) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const hide = window.setTimeout(() => setLeaving(true), SHOW_MS);
    return () => window.clearTimeout(hide);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const done = window.setTimeout(onDone, FADE_MS);
    return () => window.clearTimeout(done);
  }, [leaving, onDone]);

  return (
    <div className={`splash ${leaving ? "is-leaving" : ""}`} onClick={() => setLeaving(true)} role="presentation">
      <div className="splash-atmosphere fx-heavy" aria-hidden="true" />
      <div className="splash-particles fx-heavy" aria-hidden="true">
        {Array.from({ length: 14 }, (_, index) => <i key={index} />)}
      </div>
      <div className="splash-flare fx-heavy" aria-hidden="true" />
      <div className="splash-mark"><BrandMark trace /></div>
      <div className="splash-text">
        <h1 className="splash-title">CRESCENDO <span>LIVE</span></h1>
        <div className="splash-loading">
          <span className="loading-line" aria-hidden="true"><i /></span>
          <p>Preparando tu experiencia musical…</p>
        </div>
      </div>
    </div>
  );
}
