import { cloudStorage } from "./cloud/storage.ts";

/**
 * Arranque sin red (I4). Si la cuenta se validó con el servidor hace menos de OFFLINE_MAX_H horas EN ESTE TELÉFONO, la app abre en
 * «modo sin conexión»: se puede usar «Este dispositivo» (archivos del propio teléfono). La Nube (catálogo y descargas) sigue exigiendo
 * red y un token válido: el Worker y Supabase lo comprueban en cada petición, así que este modo no da acceso a ninguna pista de la nube.
 *
 * Seguridad: la marca guardada NO es una credencial (no contiene tokens). Falsificarla en un teléfono con root solo desbloquearía el
 * reproductor de archivos locales, que no necesita servidor. Una cuenta bloqueada o vencida puede usar los archivos propios como máximo
 * OFFLINE_MAX_H horas desde la última validación; al volver la red se valida de nuevo y se aplica el estado real de la cuenta.
 */
export const OFFLINE_MAX_H = 72;

export type Validation = { userId: string; email: string; at: number };

const KEY = "crescendo.validado.v1";

export function parseValidation(raw: string | null): Validation | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Validation>;
    return v && typeof v.userId === "string" && v.userId && typeof v.at === "number" && Number.isFinite(v.at)
      ? { userId: v.userId, email: typeof v.email === "string" ? v.email : "", at: v.at }
      : null;
  } catch {
    return null;
  }
}

/**
 * ¿Se puede abrir sin red? Solo con una validación reciente (y del mismo usuario, si se sabe cuál es la sesión guardada).
 * Una marca "del futuro" (reloj cambiado) no vale: así no se puede alargar el plazo adelantando el reloj al validar.
 */
export function offlineAllowed(v: Validation | null, userId: string | null, now: number, maxHours = OFFLINE_MAX_H): boolean {
  if (!v) return false;
  if (userId && v.userId !== userId) return false;
  const age = now - v.at;
  return age >= 0 && age <= maxHours * 3_600_000;
}

export async function readValidation(): Promise<Validation | null> {
  try { return parseValidation(await cloudStorage().get(KEY)); } catch { return null; }
}

/** Se guarda cada vez que el servidor confirma la cuenta (catálogo con sesión válida y membresía activa). */
export async function saveValidation(userId: string, email: string, now = Date.now()): Promise<void> {
  try { await cloudStorage().set(KEY, JSON.stringify({ userId, email, at: now } satisfies Validation)); } catch { /* sin almacenamiento */ }
}

/** Al cerrar sesión (o si el servidor rechaza la cuenta) la marca se borra: sin ella no hay modo sin conexión. */
export async function clearValidation(): Promise<void> {
  try { await cloudStorage().remove(KEY); } catch { /* sin almacenamiento */ }
}
