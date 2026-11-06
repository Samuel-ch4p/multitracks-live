export type CloudErrorKind =
  | "config" | "network" | "no_session" | "pending" | "expired" | "blocked" | "paused" | "device_limit" | "usage_limit"
  | "not_found" | "server" | "cancelled" | "other";

/** Solo datos que se pueden mostrar: nunca contadores de uso ni números de límites. */
type Extra = { expires_at?: string };

export class CloudError extends Error {
  kind: CloudErrorKind;
  status: number;
  extra: Extra;
  constructor(kind: CloudErrorKind, status = 0, extra: Extra = {}, message: string = kind) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.extra = extra;
  }
  /** Estados de cuenta que se muestran en pantalla completa y no se arreglan reintentando la descarga. */
  get isAccountState() {
    return this.kind === "pending" || this.kind === "expired" || this.kind === "blocked" || this.kind === "paused" || this.kind === "device_limit";
  }
  /** Errores que se resuelven escribiendo a soporte: la pantalla ofrece el botón de WhatsApp / correo. */
  get showsSupport() {
    return this.isAccountState || this.kind === "usage_limit";
  }
  /** Afectan a todas las descargas siguientes: una cola se detiene en vez de seguir intentando. */
  get blocksAll() {
    return this.kind === "no_session" || this.isAccountState || this.kind === "usage_limit";
  }
}

/** Convierte una respuesta de error de la API (JSON { error, ... }) en CloudError. */
export async function errorFromResponse(resp: Response): Promise<CloudError> {
  let body: Record<string, unknown> = {};
  try { body = (await resp.json()) as Record<string, unknown>; } catch { /* sin cuerpo */ }
  const code = typeof body.error === "string" ? body.error : "";
  const extra: Extra = {
    expires_at: typeof body.expires_at === "string" ? body.expires_at : undefined,
  };
  const s = resp.status;
  // Límites de uso (diario, mensual o 429 sin motivo): un solo caso, con mensaje suave y sin cifras.
  if (code === "daily_limit" || code === "monthly_limit" || s === 429) return new CloudError("usage_limit", s, extra, code);
  if (s === 401) return new CloudError("no_session", s, extra, code);
  if (s === 403) {
    if (code === "not_active" || code === "not_member") return new CloudError("pending", s, extra, code);
    if (code === "expired") return new CloudError("expired", s, extra, code);
    if (code === "blocked") return new CloudError("blocked", s, extra, code);
    if (code === "paused") return new CloudError("paused", s, extra, code); // cuenta en pausa por uso inusual (el servidor la activará después)
    if (code === "device_limit") return new CloudError("device_limit", s, extra, code);
    return new CloudError("other", s, extra, code);
  }
  if (s === 404) return new CloudError("not_found", s, extra, code);
  if (s >= 500) return new CloudError("server", s, extra, code);
  return new CloudError("other", s, extra, code); // incluye 400 bad_device (bug nuestro)
}

const formatDate = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" }).format(d);
};

/** Mensaje para el usuario: en español, claro y sin jerga. */
export function friendlyCloudMessage(error: unknown): string {
  if (error instanceof CloudError) {
    switch (error.kind) {
      case "config": return "La Nube Crescendo aún no está configurada en esta versión de la app.";
      case "network": return "No pudimos conectar con la Nube Crescendo. Comprueba tu conexión.";
      case "no_session": return "Tu sesión terminó. Inicia sesión de nuevo.";
      case "pending": return "Tu cuenta aún no está activa.";
      case "expired": { const d = formatDate(error.extra.expires_at); return d ? `Tu membresía venció el ${d}.` : "Tu membresía venció."; }
      case "blocked": return "Cuenta bloqueada, contáctanos.";
      case "paused": return "Tu cuenta está en pausa por uso inusual. Escríbenos por soporte.";
      case "device_limit": return "Esta cuenta ya está en uso en el máximo de dispositivos. Escríbenos para cambiar de dispositivo.";
      case "usage_limit": return "Alcanzaste el uso máximo por ahora. Inténtalo más tarde o escríbenos por soporte.";
      case "not_found": return "Esta canción no está disponible por ahora. Intenta de nuevo más tarde.";
      case "server": return "La Nube Crescendo tuvo un problema. Intenta de nuevo en unos minutos.";
      case "cancelled": return "Descarga cancelada.";
      default: return "No se pudo completar la operación, intenta en unos minutos.";
    }
  }
  const message = error instanceof Error ? error.message : "";
  if (/failed to fetch|network|load failed|timeout/i.test(message)) return "No pudimos conectar con la Nube Crescendo. Comprueba tu conexión.";
  return "No se pudo completar la operación, intenta en unos minutos.";
}
