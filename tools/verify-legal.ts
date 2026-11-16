// Notas internas del borrador legal: se quitan del texto que se empaqueta, sin perder el contenido.
// (El build además falla si alguna marca aparece en lo publicado: plugin de vite.config.ts.)
// Uso: node tools/verify-legal.ts
import { readFileSync } from "node:fs";
import { findDraftMarkers, stripDraftNotes } from "../src/legalNotes.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

const source = readFileSync(new URL("../legal/politica-y-terminos.md", import.meta.url), "utf-8");
const clean = stripDraftNotes(source);

check("(contexto) el borrador tiene notas internas", findDraftMarkers(source).length > 0, findDraftMarkers(source).join(", "));
check("después de limpiar: ninguna marca interna", findDraftMarkers(clean).length === 0, findDraftMarkers(clean).join(", "));
check("sin la línea de borrador", !/^\*Borrador/m.test(clean));
check("se conserva el contenido (responsable, derechos, términos)", /Crescendo Recursos Musicales S\.A\.S\./.test(clean) && /## Parte 2/.test(clean) && /crescendo\.rm@gmail\.com/.test(clean));
check("una nota al final de frase no deja basura", /domicilio en Bogotá, Colombia\.\s*$/m.test(clean));
check("nota con corchete escapado dentro (S.A.S.\\]) se quita entera", !clean.includes("representante legal de la S.A.S.\\]"));
check("variantes: [CONFIRMAR] sin escapar y \\[CONFIRMAR: x\\]", stripDraftNotes("Uno [CONFIRMAR] dos \\[CONFIRMAR: x\\] tres") === "Uno dos tres");
check("el texto limpio pierde poco (solo notas)", clean.length > source.length * 0.9, `${clean.length} de ${source.length} caracteres`);

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
