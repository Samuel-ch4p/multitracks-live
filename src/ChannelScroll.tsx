import { useCallback, useEffect, useRef, type ReactNode } from "react";

/**
 * Lista de canales normales con desplazamiento horizontal y alineación por canal (scroll-snap).
 * Marca con data-left / data-right si hay más canales a cada lado: el CSS dibuja un degradado discreto en ese borde.
 * No usa estado de React: solo escribe atributos en el DOM, así que desplazarse no repinta el mezclador.
 */
export default function ChannelScroll({ children }: { children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const update = useCallback(() => {
    const scroller = scrollerRef.current;
    const wrap = wrapRef.current;
    if (!scroller || !wrap) return;
    const max = scroller.scrollWidth - scroller.clientWidth;
    wrap.dataset.left = scroller.scrollLeft > 2 ? "1" : "0";
    wrap.dataset.right = scroller.scrollLeft < max - 2 ? "1" : "0";
  }, []);

  // Se vuelve a enlazar en cada render: cambian los canales al cargar otra canción.
  useEffect(() => {
    update();
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    for (const child of Array.from(scroller.children)) observer.observe(child);
    return () => observer.disconnect();
  });

  return (
    <div ref={wrapRef} className="mx-scroll" data-left="0" data-right="0">
      <div ref={scrollerRef} className="mx-main" onScroll={update}>{children}</div>
    </div>
  );
}
