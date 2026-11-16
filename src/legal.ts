/**
 * Textos legales incluidos en la app (sin internet). Fuente única: legal/politica-y-terminos.md, que se empaqueta en el build.
 * Las notas internas del borrador se quitan al compilar (plugin de vite.config.ts, ver legalNotes.ts): no viajan en el APK ni
 * llegan a la pantalla. Formato admitido: títulos ###, listas con guiones, párrafos y **negritas**.
 */
import source from "../legal/politica-y-terminos.md?raw";

/** Versión del texto que se acepta al crear la cuenta (fecha de la última actualización). Cambiarla obliga a pedir la aceptación de nuevo. */
export const LEGAL_VERSION = "2026-11-12";

export type LegalKind = "privacy" | "terms";
export type LegalBlock = { type: "h"; text: string } | { type: "p"; text: string } | { type: "ul"; items: string[] };

export const LEGAL_TITLE: Record<LegalKind, string> = { privacy: "Política de privacidad", terms: "Términos de uso" };

function parse(markdown: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "p", text: paragraph.join(" ") });
    if (list) blocks.push({ type: "ul", items: list });
    paragraph = [];
    list = null;
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith("###")) { flush(); blocks.push({ type: "h", text: line.replace(/^#+\s*/, "") }); continue; }
    if (line.startsWith("#")) { flush(); continue; } // título de documento y de parte: la pantalla ya tiene su propio título
    if (line.startsWith("- ")) {
      if (paragraph.length) { blocks.push({ type: "p", text: paragraph.join(" ") }); paragraph = []; }
      (list ??= []).push(line.slice(2).trim());
      continue;
    }
    if (list) { blocks.push({ type: "ul", items: list }); list = null; }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

// Las notas internas ya llegan quitadas por el plugin de vite.config.ts (también en desarrollo).
const clean = source.replace(/\s+([.,;:])/g, "$1");
const at = clean.search(/^## Parte 2/m);

const DOCS: Record<LegalKind, LegalBlock[]> = {
  privacy: parse(clean.slice(0, at)),
  terms: parse(clean.slice(at)),
};

export const legalDoc = (kind: LegalKind): LegalBlock[] => DOCS[kind];
