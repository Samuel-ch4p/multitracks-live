import { cloudStorage } from "./cloud/storage.ts";
import type { ClickSettings } from "./metronome";
import type { Marker } from "./markers";
import type { PadSettings } from "./padEngine";
import type { ProfileSource } from "./trackProfiles";

/**
 * Cultos (setlists guardados) y sesión actual: SOLO referencias a canciones de la nube (id, ruta, título), el orden y la
 * configuración del mezclador de cada canción. Nunca se guarda audio. Todo va por CloudStorage (Preferences en Android)
 * y SEPARADO POR user_id: dos cuentas en el mismo teléfono no ven los cultos de la otra. Cerrar sesión no borra nada.
 */
export type SongRef = { id: string; key: string; title: string };

export type TrackConfig = { fileName: string; volume: number; pan: number; muted: boolean; solo: boolean };
/** Configuración de una canción: mezcla, perfil aplicado, marcadores de la onda y los ajustes de click y pad con los que se usó. */
export type SongConfig = {
  tracks: TrackConfig[];
  profile?: ProfileSource;
  markers?: Marker[];
  click?: Partial<ClickSettings>;
  pad?: Partial<PadSettings>;
};
export type SavedSong = SongRef & { tone?: string | null; bpm?: number | null; config?: SongConfig };

export type SavedSetlist = { id: string; name: string; createdAt: number; updatedAt: number; master?: number; songs: SavedSong[] };
/** La sesión actual (autoguardado). Mismo contenido que un culto guardado, sin id propio. */
export type SavedSession = { name: string; updatedAt: number; master?: number; songs: SavedSong[] };

const LEGACY_KEY = "crescendo.setlists.v1";
const listsKey = (userId: string) => `crescendo.cultos.v2:${userId}`;
const sessionKey = (userId: string) => `crescendo.sesion.v1:${userId}`;

export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function sanitizeConfig(raw: unknown): SongConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<SongConfig>;
  const tracks: TrackConfig[] = Array.isArray(r.tracks)
    ? r.tracks.flatMap((t) => (t && typeof t.fileName === "string" && isNum(t.volume) && isNum(t.pan)
      ? [{ fileName: t.fileName, volume: Math.round(clamp(t.volume, 0, 100)), pan: Math.round(clamp(t.pan, -1, 1) * 100) / 100, muted: t.muted === true, solo: t.solo === true }]
      : []))
    : [];
  const markers: Marker[] | undefined = Array.isArray(r.markers)
    ? r.markers.flatMap((m) => (m && typeof m.name === "string" && isNum(m.position) && typeof m.color === "string"
      ? [{ id: isNum(m.id) ? m.id : Date.now(), name: m.name.slice(0, 14), position: clamp(m.position, 0, 1), color: m.color }]
      : []))
    : undefined;
  const profile = r.profile === "factory" || r.profile === "general" || r.profile === "song" ? r.profile : undefined;
  const click = r.click && typeof r.click === "object" ? r.click : undefined;
  const pad = r.pad && typeof r.pad === "object" ? r.pad : undefined;
  return { tracks, profile, markers, click, pad };
}

function sanitizeSongs(raw: unknown): SavedSong[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s) => {
    if (!s || typeof s.id !== "string" || typeof s.key !== "string" || typeof s.title !== "string") return [];
    const song: SavedSong = { id: s.id, key: s.key, title: s.title };
    if (typeof s.tone === "string") song.tone = s.tone;
    if (isNum(s.bpm)) song.bpm = s.bpm;
    const config = sanitizeConfig(s.config);
    if (config) song.config = config;
    return [song];
  });
}

function sanitizeLists(raw: unknown): SavedSetlist[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedSetlist[] = [];
  for (const item of raw) {
    const entry = item as Partial<SavedSetlist>;
    if (!entry || typeof entry.id !== "string" || typeof entry.name !== "string" || !Array.isArray(entry.songs)) continue;
    out.push({
      id: entry.id,
      name: entry.name,
      createdAt: Number(entry.createdAt) || 0,
      updatedAt: Number(entry.updatedAt) || 0,
      ...(isNum(entry.master) ? { master: Math.round(clamp(entry.master, 0, 100)) } : {}),
      songs: sanitizeSongs(entry.songs),
    });
  }
  return out;
}

async function readJson(key: string): Promise<unknown> {
  try {
    const text = await cloudStorage().get(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Cultos guardados de este usuario. La lista anterior (sin dueño) pasa al primer usuario que la abre y deja de existir. */
export async function loadSetlists(userId: string): Promise<SavedSetlist[]> {
  const own = await readJson(listsKey(userId));
  if (own) return sanitizeLists(own);
  const legacy = sanitizeLists(await readJson(LEGACY_KEY));
  if (legacy.length > 0) {
    await persistSetlists(userId, legacy);
    try { await cloudStorage().remove(LEGACY_KEY); } catch { /* sin almacenamiento */ }
  }
  return legacy;
}

export async function persistSetlists(userId: string, list: SavedSetlist[]): Promise<boolean> {
  try {
    await cloudStorage().set(listsKey(userId), JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export async function loadSession(userId: string): Promise<SavedSession | null> {
  const raw = (await readJson(sessionKey(userId))) as Partial<SavedSession> | null;
  if (!raw || typeof raw !== "object" || typeof raw.name !== "string") return null;
  const songs = sanitizeSongs(raw.songs);
  if (songs.length === 0) return null;
  return { name: raw.name, updatedAt: Number(raw.updatedAt) || 0, ...(isNum(raw.master) ? { master: Math.round(clamp(raw.master, 0, 100)) } : {}), songs };
}

/** Guarda la sesión actual; con null (o sin canciones) la borra. */
export async function saveSession(userId: string, session: SavedSession | null): Promise<void> {
  try {
    if (!session || session.songs.length === 0) await cloudStorage().remove(sessionKey(userId));
    else await cloudStorage().set(sessionKey(userId), JSON.stringify(session));
  } catch { /* sin almacenamiento: no hay autoguardado */ }
}

/** Nombre sugerido: "Culto 9 nov". */
export function defaultSetlistName(date = new Date()): string {
  const day = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(date).replace(".", "");
  return `Culto ${day}`;
}
