import { useEffect, useRef, useState } from "react";

/**
 * Lista por ventanas: muestra solo las primeras `step` filas y añade otras `step` cuando el usuario llega al final.
 * Las listas largas (cientos de artistas o resultados) no crean cientos de nodos de golpe en un celular modesto.
 * `resetKey` vuelve a la primera ventana (nueva búsqueda o carpeta distinta).
 */
export function useWindowed<T>(items: T[], resetKey: string, step = 40) {
  const [count, setCount] = useState(step);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [lastKey, setLastKey] = useState(resetKey);
  if (lastKey !== resetKey) { setLastKey(resetKey); setCount(step); }

  const more = count < items.length;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !more) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setCount((value) => value + step);
    }, { rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, count, step]);

  return {
    visible: items.slice(0, count),
    /** Marcador que va justo después de la última fila visible. */
    sentinel: more ? <div ref={sentinel} className="window-sentinel" aria-hidden="true" /> : null,
  };
}
