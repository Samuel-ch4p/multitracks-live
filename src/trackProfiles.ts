import { defaultPan, familyOf, type Family } from "./trackFamilies.ts";

/**
 * Perfiles de arranque de las pistas (volumen del fader, paneo, mute/solo y volumen del master).
 * Prioridad al cargar una canción: ESTA CANCIÓN > PREDETERMINADO (por tipo de pista) > FÁBRICA.
 * Los valores son los ajustes del usuario; la ganancia de la normalización es una etapa aparte y no entra aquí.
 * Todo en localStorage envuelto en try/catch (la app funciona igual sin él). Nunca se guarda audio.
 */
export type TrackSetting = { volume: number; pan: number; muted: boolean; solo: boolean };
export type ProfileEntry = TrackSetting & { family: Family };

export type GeneralProfile = { version: 1; master: number | null; tracks: Record<string, ProfileEntry> };
export type SongProfile = { version: 1; master: number | null; tracks: Record<string, TrackSetting> };

export type ProfileSource = "factory" | "general" | "song";
export const PROFILE_LABEL: Record<ProfileSource, string> = { factory: "Fábrica", general: "Predeterminado", song: "Esta canción" };

export const FACTORY_VOLUME = 80;
export const FACTORY_MASTER = 85;
const MAX_ENTRIES = 300;

/** Valores de fábrica de una pista: fader 80, centro (Click y Guía a la izquierda), sin mute ni solo. */
export const factorySetting = (trackName: string): TrackSetting => ({ volume: FACTORY_VOLUME, pan: defaultPan(trackName), muted: false, solo: false });

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Clave de "tipo de pista": nombre sin acentos ni mayúsculas, sin signos y sin el número del final
 * ("Keys 1" y "keys 2" → "keys"; "Batería" → "bateria"). Se le pasa el nombre ya sin el prefijo común de la canción.
 */
export function trackKey(displayName: string): string {
  const folded = displayName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = folded.split(/[^a-z0-9]+/).filter(Boolean);
  while (words.length > 1 && /^\d+$/.test(words[words.length - 1])) words.pop();
  const joined = words.join(" ").replace(/(\D)\d+$/, "$1");
  return joined || folded.trim();
}

/** Clave estable de una canción: nombre + tamaño de cada pista, resumido en 32 bits. No lee ni guarda audio. */
export function songKeyOf(files: { name: string; size: number }[]): string {
  const text = files.map((file) => `${file.name}|${file.size}`).sort().join(";");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${files.length}-${hash.toString(16).padStart(8, "0")}`;
}

// ---------- Validación (todo lo que viene de localStorage o de un archivo importado) ----------
function sanitizeSetting(raw: unknown): TrackSetting | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<TrackSetting>;
  if (!isNum(r.volume) || !isNum(r.pan)) return null;
  return { volume: Math.round(clamp(r.volume, 0, 100)), pan: Math.round(clamp(r.pan, -1, 1) * 100) / 100, muted: r.muted === true, solo: r.solo === true };
}

const FAMILIES: Family[] = ["guide", "vocal", "rhythm", "harmony", "neutral"];

export function sanitizeGeneral(raw: unknown): GeneralProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { master?: unknown; tracks?: unknown };
  const out: GeneralProfile = { version: 1, master: isNum(r.master) ? Math.round(clamp(r.master, 0, 100)) : null, tracks: {} };
  if (r.tracks && typeof r.tracks === "object") {
    for (const [key, value] of Object.entries(r.tracks as Record<string, unknown>).slice(0, MAX_ENTRIES)) {
      const setting = sanitizeSetting(value);
      const family = (value as { family?: unknown })?.family;
      if (setting && key.length > 0 && key.length <= 80) out.tracks[key] = { ...setting, family: FAMILIES.includes(family as Family) ? (family as Family) : familyOf(key) };
    }
  }
  return out;
}

export function sanitizeSong(raw: unknown): SongProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { master?: unknown; tracks?: unknown };
  const out: SongProfile = { version: 1, master: isNum(r.master) ? Math.round(clamp(r.master, 0, 100)) : null, tracks: {} };
  if (r.tracks && typeof r.tracks === "object") {
    for (const [key, value] of Object.entries(r.tracks as Record<string, unknown>).slice(0, MAX_ENTRIES)) {
      const setting = sanitizeSetting(value);
      if (setting && key.length > 0 && key.length <= 200) out.tracks[key] = setting;
    }
  }
  return out;
}

// ---------- Resolución: canción > predeterminado > fábrica ----------
export type TrackInput = { fileName: string; displayName: string };

export type Resolved = {
  settings: Map<string, TrackSetting>; // por nombre de archivo
  sources: Map<string, ProfileSource>;
  master: number;
  masterSource: ProfileSource;
  /** Perfil activo para mostrar: "Esta canción" si la canción tiene el suyo; "Predeterminado" si alguna pista lo usó; si no, "Fábrica". */
  source: ProfileSource;
};

export function resolveProfile(tracks: TrackInput[], song: SongProfile | null, general: GeneralProfile | null): Resolved {
  const settings = new Map<string, TrackSetting>();
  const sources = new Map<string, ProfileSource>();
  let usedGeneral = false;
  for (const track of tracks) {
    const fromSong = song?.tracks[track.fileName];
    const fromGeneral = general?.tracks[trackKey(track.displayName)];
    if (fromSong) { settings.set(track.fileName, { ...fromSong }); sources.set(track.fileName, "song"); }
    else if (fromGeneral) {
      settings.set(track.fileName, { volume: fromGeneral.volume, pan: fromGeneral.pan, muted: fromGeneral.muted, solo: fromGeneral.solo });
      sources.set(track.fileName, "general");
      usedGeneral = true;
    } else { settings.set(track.fileName, factorySetting(track.displayName)); sources.set(track.fileName, "factory"); }
  }
  const master = song?.master ?? general?.master ?? FACTORY_MASTER;
  const masterSource: ProfileSource = song?.master != null ? "song" : general?.master != null ? "general" : "factory";
  const source: ProfileSource = song && Object.keys(song.tracks).length > 0 ? "song" : usedGeneral || (general?.master != null) ? "general" : "factory";
  return { settings, sources, master, masterSource, source };
}

// ---------- Construcción de perfiles a partir del mezclador ----------
export type LiveTrack = TrackInput & TrackSetting;

/** Guarda los tipos de pista actuales sobre el perfil general (los tipos que no están en esta canción se conservan). */
export function buildGeneral(previous: GeneralProfile | null, tracks: LiveTrack[], master: number): GeneralProfile {
  const next: GeneralProfile = { version: 1, master: Math.round(clamp(master, 0, 100)), tracks: { ...(previous?.tracks ?? {}) } };
  const seen = new Set<string>();
  for (const track of tracks) {
    const key = trackKey(track.displayName);
    if (seen.has(key)) continue; // varias pistas del mismo tipo ("Keys 1..9"): manda la primera
    seen.add(key);
    next.tracks[key] = { volume: track.volume, pan: track.pan, muted: track.muted, solo: track.solo, family: familyOf(track.displayName) };
  }
  return next;
}

export function buildSong(tracks: LiveTrack[], master: number): SongProfile {
  const out: SongProfile = { version: 1, master: Math.round(clamp(master, 0, 100)), tracks: {} };
  for (const track of tracks) out.tracks[track.fileName] = { volume: track.volume, pan: track.pan, muted: track.muted, solo: track.solo };
  return out;
}

// ---------- Almacenamiento (localStorage con try/catch) ----------
const GENERAL_KEY = "crescendo-profile-general-v1";
const SONG_PREFIX = "crescendo-profile-song-v1:";

function read(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}
function write(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function remove(key: string) {
  try { localStorage.removeItem(key); } catch { /* sin almacenamiento */ }
}

export const loadGeneral = () => sanitizeGeneral(read(GENERAL_KEY));
export const saveGeneralProfile = (profile: GeneralProfile) => write(GENERAL_KEY, profile);
export const clearGeneral = () => remove(GENERAL_KEY);
export const loadSongProfile = (songKey: string) => sanitizeSong(read(SONG_PREFIX + songKey));
export const saveSongProfile = (songKey: string, profile: SongProfile) => write(SONG_PREFIX + songKey, profile);
export const clearSongProfile = (songKey: string) => remove(SONG_PREFIX + songKey);

// ---------- Exportar / importar (archivo JSON pequeño) ----------
export function exportGeneral(profile: GeneralProfile): string {
  return JSON.stringify({ app: "crescendo-live", kind: "perfil-predeterminado", version: 1, profile }, null, 2);
}

/** Devuelve el perfil importado o null si el texto no es un perfil válido. */
export function importGeneral(text: string): GeneralProfile | null {
  try {
    const data = JSON.parse(text) as { app?: unknown; profile?: unknown };
    if (!data || data.app !== "crescendo-live") return null;
    const profile = sanitizeGeneral(data.profile);
    return profile && (Object.keys(profile.tracks).length > 0 || profile.master !== null) ? profile : null;
  } catch {
    return null;
  }
}
