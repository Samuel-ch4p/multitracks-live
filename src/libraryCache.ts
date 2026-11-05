import type { IndexData } from "./searchIndex";

/** Catálogo ya preparado, en memoria de la sesión (solo texto). Ajustes → "Limpiar temporales" lo vacía. */
export const libraryCache: { index: IndexData | null } = { index: null };
