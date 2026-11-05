import { useEffect, useRef, useState } from "react";

/**
 * Lista por ventanas: muestra solo las primeras `step` filas y añade otras `step` cuando el usuario se acerca al final.
 * Las listas largas (cientos de artistas o resultados) no crean cientos de nodos de golpe en un celular modesto.
 * `resetKey` vuelve a la primera ventana (nueva búsqueda o carpeta distinta).
 *
 * El observador usa como raíz el contenedor con desplazamiento más cercano (no la pantalla): así el margen de 900 px se aplica de verdad
 * dentro de listas que se desplazan en un contenedor propio (antes, en pantallas bajas, el marcador solo contaba al verse del todo
 * y la lista se quedaba a medias). Además hay un botón "Mostrar más" como respaldo: siempre se puede llegar al final.
 */
function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll") return parent;
  }
  return null;
}

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
    }, { root: scrollParent(node), rootMargin: "0px 0px 900px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, count, step]);

  return {
    visible: items.slice(0, count),
    /** Marcador que va justo después de la última fila visible (con botón de respaldo). */
    sentinel: more ? (
      <div ref={sentinel} className="window-sentinel">
        <button type="button" className="lib-more" onClick={() => setCount((value) => value + step)}>
          Mostrar más · quedan {items.length - count}
        </button>
      </div>
    ) : null,
  };
}
