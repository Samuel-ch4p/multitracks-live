import { Fragment, type ReactNode } from "react";
import { SOPORTE_EMAIL, mailtoLink } from "./cloud/config";
import { openExternal } from "./externalLink";
import { LEGAL_TITLE, legalDoc, type LegalKind } from "./legal";
import "./styles/legal.css";

/** Texto en línea: **negritas** y el correo de soporte como enlace mailto:. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).flatMap<ReactNode>((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return [<strong key={i}><Fragment>{inline(part.slice(2, -2))}</Fragment></strong>];
    return part.split(SOPORTE_EMAIL).flatMap<ReactNode>((piece, j, all) => {
      const nodes: ReactNode[] = [piece];
      if (j < all.length - 1) nodes.push(<a key={`${i}-${j}`} href={mailtoLink()} onClick={(e) => { e.preventDefault(); void openExternal(mailtoLink()); }}>{SOPORTE_EMAIL}</a>);
      return nodes;
    });
  });
}

/** Cuerpo del documento (títulos, párrafos y listas). */
export function LegalText({ kind }: { kind: LegalKind }) {
  return (
    <div className="legal-text">
      {legalDoc(kind).map((block, i) =>
        block.type === "h" ? <h2 key={i}>{block.text}</h2>
        : block.type === "ul" ? <ul key={i}>{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ul>
        : <p key={i}>{inline(block.text)}</p>
      )}
    </div>
  );
}

/** Pantalla completa con encabezado fijo y texto con desplazamiento. Se abre encima del formulario, que conserva lo escrito. */
export function LegalScreen({ kind, onClose }: { kind: LegalKind; onClose: () => void }) {
  return (
    <div className="legal-screen" role="dialog" aria-modal="true" aria-label={LEGAL_TITLE[kind]}>
      <header className="legal-head">
        <button type="button" className="legal-back" onClick={onClose} aria-label="Volver">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          <span>Volver</span>
        </button>
        <h1>{LEGAL_TITLE[kind]}</h1>
      </header>
      <div className="legal-scroll"><LegalText kind={kind} /></div>
    </div>
  );
}
