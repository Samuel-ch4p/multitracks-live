import { useId } from "react";

type Props = { className?: string; trace?: boolean };

/**
 * Logo "C" de anillos plateados en vectores (siempre nítido, a cualquier tamaño y sin recuadro).
 * Está centrado en el centro del círculo (viewBox desplazado) para que coincida con el icono del arranque de Android
 * (android/app/src/main/res/drawable/splash_icon.xml). Con `trace`, un trazo de luz recorre los anillos (splash).
 */
const RINGS = [
  { id: "outer", d: "M88 29a43 43 0 1 0 0 62", width: 8 },
  { id: "middle", d: "M79 41a29 29 0 1 0 0 38", width: 7 },
  { id: "inner", d: "M70 52a16 16 0 1 0 0 16", width: 6 },
] as const;

export default function BrandMark({ className = "", trace = false }: Props) {
  const gradient = `silver-${useId().replace(/:/g, "")}`;
  return (
    <svg aria-hidden="true" className={`brand-mark ${className}`} viewBox="-1.8 0 120 120">
      <defs>
        <linearGradient id={gradient} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#8a929e" />
          <stop offset=".42" stopColor="#f2f3f4" />
          <stop offset=".68" stopColor="#adb3bb" />
          <stop offset="1" stopColor="#f7f8f8" />
        </linearGradient>
      </defs>
      {RINGS.map((ring) => (
        <path key={ring.id} className={`brand-ring ring-${ring.id}`} d={ring.d} fill="none" stroke={`url(#${gradient})`} strokeLinecap="round" strokeWidth={ring.width} />
      ))}
      {trace && RINGS.map((ring) => (
        <path key={`t-${ring.id}`} className={`brand-trace trace-${ring.id}`} d={ring.d} pathLength={100} fill="none" stroke="#fff" strokeLinecap="round" strokeWidth={ring.width} />
      ))}
    </svg>
  );
}
