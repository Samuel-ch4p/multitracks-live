import { CloudError } from "./errors.ts";

/**
 * Obtención del token de acceso con renovación tolerante a fallos de red.
 *
 * Regla: un fallo de red, un tiempo agotado o un error del servidor de autenticación (5xx/429) NUNCA es "sesión terminada".
 * Solo un rechazo definitivo (token de renovación inválido, revocado, ya usado, usuario o sesión inexistentes) cierra la sesión.
 * Módulo puro (sin supabase-js): el cliente se inyecta, así se prueba sin red (tools/verify-token.ts).
 */

/** Lo mínimo de una sesión de Supabase que se usa aquí. */
export type SessionLike = { access_token: string; refresh_token?: string; expires_at?: number } | null;
type AuthResult = { data: { session: SessionLike }; error: unknown };

/** Lo mínimo del cliente de autenticación de Supabase. */
export type AuthLike = {
  getSession(): Promise<AuthResult>;
  refreshSession(): Promise<AuthResult>;
};

export type TokenOptions = {
  /** Segundos antes del vencimiento a partir de los cuales se renueva. */
  refreshMarginS?: number;
  /** Esperas entre intentos de renovación cuando el fallo es de red (ms). */
  backoffMs?: number[];
  /** Tiempo máximo de cada intento (ms). */
  attemptTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULTS = { refreshMarginS: 300, backoffMs: [500, 1500, 4000], attemptTimeoutMs: 10000 };

/** Códigos de GoTrue que significan "esta sesión ya no sirve" (no se arreglan reintentando). */
const REJECTED_CODES = new Set([
  "refresh_token_not_found", "refresh_token_already_used", "session_not_found", "session_expired",
  "user_not_found", "user_banned", "bad_jwt", "invalid_grant", "invalid_credentials",
]);

/**
 * ¿El error de renovación es un rechazo definitivo ("rejected") o algo pasajero ("transient")?
 * Ante la duda: pasajero (se conserva la sesión). Mejor reintentar de más que expulsar a alguien en pleno culto.
 */
export function classifyAuthError(error: unknown): "rejected" | "transient" {
  if (!error || typeof error !== "object") return "transient";
  const e = error as { name?: string; status?: number; code?: string; message?: string };
  if (e.name === "AuthRetryableFetchError" || e.name === "TimeoutError" || e.name === "AbortError") return "transient";
  if (e.name === "AuthSessionMissingError" || e.name === "AuthInvalidTokenResponseError") return "rejected";
  if (e.code && REJECTED_CODES.has(e.code)) return "rejected";
  const status = typeof e.status === "number" ? e.status : 0;
  if (status === 0 || status === 408 || status === 429 || status >= 500) return "transient";
  if (/failed to fetch|network|load failed|timeout|timed out/i.test(e.message ?? "")) return "transient";
  // 400/401/403 de la API de autenticación con un error de token: rechazo.
  if ((status === 400 || status === 401 || status === 403) && (e.name === "AuthApiError" || /refresh token|invalid|revoked|expired|not found/i.test(e.message ?? ""))) return "rejected";
  return "transient";
}

const timeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("tiempo agotado"), { name: "TimeoutError" })), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });

/**
 * Renueva la sesión con reintentos (retroceso) ante fallos pasajeros.
 * Devuelve la sesión nueva; lanza CloudError("no_session") solo ante rechazo definitivo y CloudError("network") si la red no deja.
 */
export async function refreshWithRetry(auth: AuthLike, options: TokenOptions = {}): Promise<NonNullable<SessionLike>> {
  const backoff = options.backoffMs ?? DEFAULTS.backoffMs;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const perAttempt = options.attemptTimeoutMs ?? DEFAULTS.attemptTimeoutMs;
  let last: unknown = null;
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    if (attempt > 0) await sleep(backoff[attempt - 1]);
    try {
      const { data, error } = await timeout(auth.refreshSession(), perAttempt);
      if (!error && data.session) return data.session;
      if (error && classifyAuthError(error) === "rejected") throw new CloudError("no_session", 401, {}, "renovación rechazada");
      if (!error && !data.session) throw new CloudError("no_session", 401, {}, "sin sesión");
      last = error;
    } catch (e) {
      if (e instanceof CloudError) throw e;
      if (classifyAuthError(e) === "rejected") throw new CloudError("no_session", 401, {}, "renovación rechazada");
      last = e;
    }
  }
  throw new CloudError("network", 0, {}, last instanceof Error ? last.message : "no se pudo renovar la sesión");
}

/**
 * Token listo para usar. Si quedan menos de `refreshMarginS` segundos, se renueva antes; si la renovación falla por la red y el
 * token actual aún no venció, se usa el actual (sirve unos minutos más). Nunca convierte un fallo de red en "sesión terminada".
 */
export async function obtainAccessToken(auth: AuthLike, options: TokenOptions = {}, force = false): Promise<string> {
  const now = options.now ?? (() => Date.now());
  const margin = options.refreshMarginS ?? DEFAULTS.refreshMarginS;
  let session: SessionLike = null;
  try {
    const { data, error } = await auth.getSession();
    session = data.session;
    // getSession intenta renovar por su cuenta si el token venció: si falló por la red, la sesión guardada sigue ahí.
    if (!session && error) {
      if (classifyAuthError(error) === "rejected") throw new CloudError("no_session", 401, {}, "sesión rechazada");
      return (await refreshWithRetry(auth, options)).access_token;
    }
  } catch (e) {
    if (e instanceof CloudError) throw e;
    if (classifyAuthError(e) === "rejected") throw new CloudError("no_session", 401, {}, "sesión rechazada");
    return (await refreshWithRetry(auth, options)).access_token;
  }
  if (!session) throw new CloudError("no_session", 401, {}, "sin sesión");
  const left = (session.expires_at ?? 0) - now() / 1000;
  if (!force && left >= margin) return session.access_token;
  try {
    return (await refreshWithRetry(auth, options)).access_token;
  } catch (e) {
    // Red caída pero el token todavía vale: se usa (el servidor lo aceptará hasta su vencimiento).
    if (e instanceof CloudError && e.kind === "network" && left > 5 && !force) return session.access_token;
    throw e;
  }
}

/**
 * Qué hace la app cuando Supabase avisa SIGNED_OUT. Con audio sonando no se desmonta (cortaría la canción en pleno culto):
 * se espera a que se detenga. Sin token válido ya no hay descargas nuevas, así que esperar no abre ningún acceso.
 */
export function signedOutAction(audioActive: boolean): "unmount" | "wait" {
  return audioActive ? "wait" : "unmount";
}
