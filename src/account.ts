import { supabase } from "./cloud/auth";
import { cloudStorage } from "./cloud/storage";
import { libraryCache } from "./libraryCache";
import { FACTORY_MASTER, loadGeneral } from "./trackProfiles";

export type Membership = { status: string; plan: string | null; expiresAt: string | null };

/**
 * Lee MI fila de la tabla `members` (una política del servidor solo deja leer la propia). Si la consulta falla o no hay fila,
 * devuelve null y la pantalla oculta la tarjeta: nunca se inventan datos.
 */
export async function loadMembership(): Promise<Membership | null> {
  try {
    const { data, error } = await supabase().from("members").select("status, plan, expires_at").limit(1).maybeSingle();
    if (error || !data) return null;
    const row = data as { status?: unknown; plan?: unknown; expires_at?: unknown };
    if (typeof row.status !== "string") return null;
    return {
      status: row.status,
      plan: typeof row.plan === "string" && row.plan ? row.plan : null,
      expiresAt: typeof row.expires_at === "string" && row.expires_at ? row.expires_at : null,
    };
  } catch {
    return null;
  }
}

const STATUS_LABEL: Record<string, string> = { active: "Activa", pending: "Pendiente de activación", expired: "Vencida", blocked: "Bloqueada" };
export const statusLabel = (status: string) => STATUS_LABEL[status.toLowerCase()] ?? status;

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // Fechas a medianoche UTC (o sin hora): se muestran tal cual, sin restar un día por la zona horaria.
  const dateOnly = /^\d{4}-\d{2}-\d{2}(T00:00:00(\.0+)?(Z|\+00:00)?)?$/.test(iso);
  return date.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric", timeZone: dateOnly ? "UTC" : undefined });
}

const MASTER_KEY = "crescendo-master-default-v1";

/** Volumen maestro predeterminado elegido en Ajustes; null si el usuario nunca lo cambió. */
export function getStoredMaster(): number | null {
  try {
    const raw = localStorage.getItem(MASTER_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null;
  } catch {
    return null;
  }
}
/** Valor mostrado en Ajustes. Si lo guardó la versión con perfiles, se respeta como punto de partida (solo se lee). */
export const getDefaultMaster = () => getStoredMaster() ?? loadGeneral()?.master ?? FACTORY_MASTER;
export function setDefaultMaster(value: number) {
  try { localStorage.setItem(MASTER_KEY, String(Math.min(100, Math.max(0, Math.round(value))))); } catch { /* solo vale para esta sesión */ }
}

/** Limpia lo temporal: la copia guardada del catálogo (solo texto) y el catálogo en memoria. Las canciones nunca se guardan en el dispositivo. */
export async function clearTemporaryData() {
  libraryCache.index = null;
  try { await cloudStorage().remove("crescendo.catalog.v1"); } catch { /* sin almacenamiento */ }
  try { indexedDB.deleteDatabase("crescendo-meta"); } catch { /* sin IndexedDB */ }
}
