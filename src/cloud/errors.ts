export type CloudErrorKind =
  | "config" | "network" | "no_session" | "pending" | "expired" | "blocked" | "device_limit" | "daily_limit"
  | "not_found" | "server" | "cancelled" | "other";

type Extra = { expires_at?: string; max_devices?: number; daily_limit?: number };

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
    return this.kind === "pending" || this.kind === "expired" || this.kind === "blocked" || this.kind === "device_limit";
  }
}

/** Convierte una respuesta de error de la API (JSON { error, ... }) en CloudError. */
export async function errorFromResponse(resp: Response): Promise<CloudError> {
  let body: Record<string, unknown> = {};
  try { body = (await resp.json()) as Record<string, unknown>; } catch { /* sin cuerpo */ }
  const code = typeof body.error === "string" ? body.error : "";
  const extra: Extra = {
    expires_at: typeof body.expires_at === "string" ? body.expires_at : undefined,
    max_devices: typeof body.max_devices === "number" ? body.max_devices : undefined,
    daily_limit: typeof body.daily_limit === "number" ? body.daily_limit : undefined,
  };
  const s = resp.status;
  if (s === 401) return new CloudError("no_session", s, extra, code);
  if (s === 403) {
    if (code === "not_active" || code === "not_member") return new CloudError("pending", s, extra, code);
    if (code === "expired") return new CloudError("expired", s, extra, code);
    if (code === "blocked") return new CloudError("blocked", s, extra, code);
    if (code === "device_limit") return new CloudError("device_limit", s, extra, code);
    return new CloudError("other", s, extra, code);
  }
  if (s === 429) return new CloudError("daily_limit", s, extra, code);
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
      case "device_limit": return `Esta cuenta ya está en ${error.extra.max_devices ?? 2} dispositivos. Escríbenos para cambiar de dispositivo.`;
      case "daily_limit": return `Llegaste al límite de ${error.extra.daily_limit ?? "canciones"} canciones por hoy. Vuelve mañana.`;
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
