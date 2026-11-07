/**
 * Mientras hay una hoja o diálogo abierto (cargas, hojas de cultos, marcadores, cajones de Click/PAD):
 *  · el fondo queda inerte (inert: sin toques, sin foco, sin lectores de pantalla); solo el diálogo recibe interacción;
 *  · <html> recibe la clase "has-modal" (sin rebote ni arrastre del fondo; ver dialogs.css).
 * Se engancha una sola vez: vigila el árbol y marca como inertes los «hermanos» del camino hacia el diálogo más reciente.
 */
const MODAL = ".load-layer, .sheet-layer, .drawer-backdrop";

export function startModalGuard(): () => void {
  const root = document.getElementById("root");
  if (!root) return () => undefined;
  let marked = new Set<Element>();

  const apply = () => {
    const layers = document.querySelectorAll(MODAL);
    const top = layers.length ? layers[layers.length - 1] : null;
    document.documentElement.classList.toggle("has-modal", !!top);
    const want = new Set<Element>();
    for (let node: Element | null = top; node && node !== document.body; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement?.children ?? [])) {
        if (sibling !== node && sibling.tagName !== "SCRIPT") want.add(sibling);
      }
    }
    for (const el of marked) if (!want.has(el)) el.removeAttribute("inert");
    for (const el of want) if (!marked.has(el)) el.setAttribute("inert", "");
    marked = want;
  };

  const observer = new MutationObserver(apply);
  observer.observe(root, { childList: true, subtree: true });
  apply();
  return () => {
    observer.disconnect();
    for (const el of marked) el.removeAttribute("inert");
    document.documentElement.classList.remove("has-modal");
  };
}
