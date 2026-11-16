/**
 * Notas internas del borrador legal ([CONFIRMAR …] y la línea "*Borrador…"). Se quitan EN EL BUILD (plugin de vite.config.ts),
 * así nunca viajan dentro del APK. Además el build falla si alguna marca aparece en lo publicado. Módulo puro (lo usan Vite y las pruebas).
 */

/** Quita las notas internas (escritas como \[CONFIRMAR …\] en Markdown) y la línea de borrador. */
export function stripDraftNotes(text: string): string {
  return text
    .replace(/[ \t]*\\?\[CONFIRMAR[^\]]*\]/g, "")
    .split("\n")
    .filter((line) => !/^\*Borrador/.test(line.trim()))
    .join("\n");
}

/** Marcas que nunca deben aparecer en el código publicado. */
export const DRAFT_MARKERS = ["CONFIRMAR", "Borrador base", "No es asesoría legal", "revisar antes de publicar"];

/** Devuelve las marcas encontradas en un texto (vacío = limpio). */
export function findDraftMarkers(text: string): string[] {
  return DRAFT_MARKERS.filter((marker) => text.includes(marker));
}
