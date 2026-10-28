/**
 * Marcadores de sección (Intro, Verso, Coro…) de cada canción. Se guardan en localStorage con la misma clave de canción
 * que los perfiles (songKeyOf). Todo con try/catch: sin almacenamiento la app sigue funcionando (solo vale para la sesión).
 */
export type Marker = { id: number; name: string; position: number; color: string };

export const MARKER_NAMES = ["Intro", "Verso", "Pre-coro", "Coro", "Puente", "Final"];
/** Referencias a tokens.css (los marcadores guardados antes con hex siguen funcionando). */
export const MARKER_COLORS = ["var(--fam-rhythm)", "var(--fam-harmony)", "var(--fam-guide)", "var(--fam-vocal)", "var(--c-success)", "var(--c-warn)"];

const keyOf = (songKey: string) => `crescendo-markers-v1:${songKey}`;
const HINT_KEY = "crescendo-marker-hint-v1";

export function loadMarkers(songKey: string): Marker[] {
  try {
    const raw = localStorage.getItem(keyOf(songKey));
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((item): item is Marker => !!item && typeof item.name === "string" && typeof item.position === "number" && typeof item.color === "string")
      .map((item) => ({ id: Number(item.id) || Date.now(), name: item.name.slice(0, 14), position: Math.min(1, Math.max(0, item.position)), color: item.color }))
      .sort((a, b) => a.position - b.position);
  } catch {
    return [];
  }
}

export function saveMarkers(songKey: string, markers: Marker[]) {
  try {
    if (markers.length === 0) localStorage.removeItem(keyOf(songKey));
    else localStorage.setItem(keyOf(songKey), JSON.stringify(markers));
  } catch { /* sin almacenamiento: los marcadores solo duran esta sesión */ }
}

export function hintDismissed(): boolean {
  try { return localStorage.getItem(HINT_KEY) === "1"; } catch { return false; }
}

export function dismissHint() {
  try { localStorage.setItem(HINT_KEY, "1"); } catch { /* sin almacenamiento */ }
}
