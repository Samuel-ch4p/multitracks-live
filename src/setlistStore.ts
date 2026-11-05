import { cloudStorage } from "./cloud/storage";

/**
 * Setlists guardados: SOLO referencias (id y ruta de la canción en la nube, su título, el orden y el nombre del setlist).
 * Nunca se guarda audio. Va detrás de la interfaz CloudStorage (Preferences en Android).
 */
export type SongRef = { id: string; key: string; title: string };
export type SavedSetlist = { id: string; name: string; createdAt: number; updatedAt: number; songs: SongRef[] };

const KEY = "crescendo.setlists.v1";

export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sanitize(raw: unknown): SavedSetlist[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedSetlist[] = [];
  for (const item of raw) {
    const entry = item as Partial<SavedSetlist>;
    if (!entry || typeof entry.id !== "string" || typeof entry.name !== "string" || !Array.isArray(entry.songs)) continue;
    const songs = entry.songs
      .filter((s): s is SongRef => !!s && typeof s.id === "string" && typeof s.key === "string" && typeof s.title === "string")
      .map((s) => ({ id: s.id, key: s.key, title: s.title }));
    out.push({ id: entry.id, name: entry.name, createdAt: Number(entry.createdAt) || 0, updatedAt: Number(entry.updatedAt) || 0, songs });
  }
  return out;
}

export async function loadSetlists(): Promise<SavedSetlist[]> {
  try {
    const text = await cloudStorage().get(KEY);
    return text ? sanitize(JSON.parse(text)) : [];
  } catch {
    return [];
  }
}

export async function persistSetlists(list: SavedSetlist[]): Promise<boolean> {
  try {
    await cloudStorage().set(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Nombre sugerido: el día de hoy, por ejemplo "Domingo 9 nov". */
export function defaultSetlistName(date = new Date()): string {
  const weekday = new Intl.DateTimeFormat("es", { weekday: "long" }).format(date);
  const day = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(date).replace(".", "");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${day}`;
}
