import { songKeyOf } from "./trackProfiles.ts";

/**
 * Canciones de «Este dispositivo» en sesiones y cultos (1.1.0). Nunca se guarda audio: solo una REFERENCIA (nombre, clave de la
 * canción y lista de archivos con su tamaño) más su mezcla. Al cargar el culto quedan en el setlist como «Elige el archivo»; cuando el
 * usuario vuelve a elegir el archivo en Biblioteca › Este dispositivo, se reconoce y recupera su lugar y su mezcla.
 * Reglas puras: se prueban en tools/verify-local-songs.ts.
 */
export type LocalRef = { songKey: string; files: { name: string; size: number }[] };

/** Prefijo del id guardado de una canción local (las de la nube usan el id del catálogo). */
export const LOCAL_ID_PREFIX = "local:";

export function localRefOf(files: { name: string; size: number }[]): LocalRef {
  return { songKey: songKeyOf(files), files: files.map((file) => ({ name: file.name, size: file.size })) };
}

/** Valida una referencia leída del almacenamiento (datos de versiones anteriores o dañados → null). */
export function sanitizeLocalRef(raw: unknown): LocalRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<LocalRef>;
  if (typeof r.songKey !== "string" || !r.songKey || !Array.isArray(r.files)) return null;
  const files = r.files
    .filter((f): f is { name: string; size: number } => !!f && typeof f.name === "string" && typeof f.size === "number" && Number.isFinite(f.size))
    .slice(0, 128)
    .map((f) => ({ name: f.name.slice(0, 200), size: Math.max(0, Math.round(f.size)) }));
  return files.length > 0 ? { songKey: r.songKey.slice(0, 64), files } : null;
}

const sameNames = (a: { name: string }[], b: { name: string }[]) => {
  if (a.length !== b.length) return false;
  const set = new Set(a.map((f) => f.name.toLowerCase()));
  return b.every((f) => set.has(f.name.toLowerCase()));
};

/**
 * ¿Qué canción «Elige el archivo» corresponde a los archivos elegidos? Primero la coincidencia exacta (mismos nombres y tamaños);
 * si no, la del mismo título con los mismos nombres de pista (p. ej. el mismo ZIP vuelto a exportar). Devuelve el id o null.
 */
export function matchLocalPlaceholder<T extends { id: number; name: string; local?: LocalRef }>(
  placeholders: T[],
  name: string,
  files: { name: string; size: number }[],
): number | null {
  const key = songKeyOf(files);
  const exact = placeholders.find((p) => p.local?.songKey === key);
  if (exact) return exact.id;
  const byName = placeholders.filter((p) => p.local && p.name.trim().toLowerCase() === name.trim().toLowerCase() && sameNames(p.local.files, files));
  return byName.length === 1 ? byName[0].id : null;
}
