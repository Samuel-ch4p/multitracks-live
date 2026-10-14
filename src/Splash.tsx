import { useEffect, useState, type CSSProperties } from "react";
import emblemUrl from "./assets/emblem.png";

type Props = { onDone: () => void };

const SHOW_MS = 3600; // cuándo empieza a desvanecerse
const FADE_MS = 500;

/** Pantalla de inicio: emblema plateado, nombre y "preparando…". Un toque la salta. */
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
    <div
      className={`splash ${leaving ? "is-leaving" : ""}`}
      onClick={() => setLeaving(true)}
      role="presentation"
      style={{ "--emblem": `url(${emblemUrl})` } as CSSProperties}
    >
      <div className="splash-center">
        <div className="splash-emblem">
          <img src={emblemUrl} alt="" />
          <i aria-hidden="true" />
        </div>
        <h1 className="splash-title">CRESCENDO <span>LIVE</span></h1>
        <div className="splash-loading">
          <span className="splash-spinner" aria-hidden="true" />
          <p>Preparando tu experiencia musical…</p>
        </div>
      </div>
    </div>
  );
}
