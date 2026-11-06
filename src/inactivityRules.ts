/**
 * Reglas puras del cierre de sesión por ausencia e inactividad (sin temporizadores ni almacenamiento: solo marcas de tiempo).
 * Los minutos vienen de cloud/config.ts (GRACIA_FUERA_MIN, INACTIVIDAD_MIN); aquí se reciben como argumento para poder probarlas.
 */
export type LeaveRecord = { leftAt: number; wasPlaying: boolean };

const MIN = 60_000;

/**
 * Al volver a la app (o en un arranque en frío): cierra la sesión si no sonaba audio al salir y pasaron más de `graceMin` minutos,
 * o si sonaba y pasaron más de `idleMin`. Nunca si hay audio sonando o una descarga en curso en este momento.
 */
export function absenceExpired(record: LeaveRecord | null, now: number, busy: boolean, graceMin: number, idleMin: number): boolean {
  if (!record || busy) return false;
  const away = now - record.leftAt;
  if (!Number.isFinite(away) || away < 0) return false; // reloj cambiado hacia atrás: no se cierra por una marca imposible
  return away > (record.wasPlaying ? idleMin : graceMin) * MIN;
}

/** En primer plano: cierra la sesión tras `idleMin` minutos sin interacción, y solo si no hay audio ni descarga. */
export function idleExpired(lastActivity: number, now: number, busy: boolean, idleMin: number): boolean {
  if (busy) return false;
  const idle = now - lastActivity;
  return Number.isFinite(idle) && idle > idleMin * MIN;
}

export function parseLeaveRecord(raw: string | null): LeaveRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LeaveRecord>;
    return value && typeof value.leftAt === "number" && Number.isFinite(value.leftAt) ? { leftAt: value.leftAt, wasPlaying: value.wasPlaying === true } : null;
  } catch {
    return null;
  }
}
