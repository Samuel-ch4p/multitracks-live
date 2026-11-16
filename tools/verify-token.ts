// B1: un fallo de red al renovar el token NUNCA cierra la sesión; solo un rechazo definitivo. Sin red real (cliente simulado).
// Uso: node tools/verify-token.ts
import { CloudError } from "../src/cloud/errors.ts";
import { classifyAuthError, obtainAccessToken, refreshWithRetry, signedOutAction, type AuthLike, type SessionLike } from "../src/cloud/tokenRefresh.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

const NOW = 1_800_000_000_000;
const now = () => NOW;
const noSleep = async () => {};
const session = (secondsLeft: number, token = "viejo"): NonNullable<SessionLike> => ({ access_token: token, refresh_token: "r", expires_at: NOW / 1000 + secondsLeft });
const netErr = () => Object.assign(new Error("Failed to fetch"), { name: "AuthRetryableFetchError", status: 0 });
const rejected = () => Object.assign(new Error("Invalid Refresh Token: Refresh Token Not Found"), { name: "AuthApiError", status: 400, code: "refresh_token_not_found" });

/** Cliente simulado: getSession devuelve `stored`; refreshSession consume la lista `refreshes` (error o sesión). */
function fakeAuth(stored: SessionLike, refreshes: Array<"net" | "reject" | "hang" | NonNullable<SessionLike>>, getError: unknown = null) {
  let calls = 0;
  const auth: AuthLike & { calls: () => number } = {
    calls: () => calls,
    async getSession() { return { data: { session: stored }, error: getError }; },
    async refreshSession() {
      const next = refreshes[Math.min(calls++, refreshes.length - 1)];
      if (next === "net") return { data: { session: null }, error: netErr() };
      if (next === "reject") return { data: { session: null }, error: rejected() };
      if (next === "hang") return new Promise(() => {}) as never;
      return { data: { session: next }, error: null };
    },
  };
  return auth;
}

const kindOf = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof CloudError ? e.kind : "otro"; } };

// Clasificación
check("red caída (AuthRetryableFetchError) → pasajero", classifyAuthError(netErr()) === "transient");
check("tiempo agotado → pasajero", classifyAuthError(Object.assign(new Error("x"), { name: "TimeoutError" })) === "transient");
check("500 del servidor de autenticación → pasajero", classifyAuthError({ name: "AuthApiError", status: 503, message: "upstream" }) === "transient");
check("429 → pasajero", classifyAuthError({ name: "AuthApiError", status: 429, message: "rate limit" }) === "transient");
check("error desconocido → pasajero (ante la duda se conserva la sesión)", classifyAuthError(new Error("algo raro")) === "transient");
check("refresh_token_not_found → rechazo", classifyAuthError(rejected()) === "rejected");
check("refresh_token_already_used → rechazo", classifyAuthError({ name: "AuthApiError", status: 400, code: "refresh_token_already_used" }) === "rejected");
check("sesión inexistente → rechazo", classifyAuthError({ name: "AuthSessionMissingError" }) === "rejected");

// Token vigente: no se renueva
{
  const auth = fakeAuth(session(3000), ["net"]);
  const token = await obtainAccessToken(auth, { now, sleep: noSleep });
  check("token con margen: se usa sin renovar", token === "viejo" && auth.calls() === 0);
}
// Red caída durante la renovación, token aún válido → se usa el actual; la sesión NO se cierra
{
  const auth = fakeAuth(session(120), ["net"]);
  const token = await obtainAccessToken(auth, { now, sleep: noSleep });
  check("red caída al renovar (quedan 2 min): sigue con el token actual", token === "viejo", `intentos ${auth.calls()}`);
  check("…con reintentos (1 + 3 con retroceso)", auth.calls() === 4);
}
// Token vencido y sin red → "network", nunca "no_session"
{
  const auth = fakeAuth(null, ["net"], netErr());
  check("token vencido + red caída: error de RED (no cierra sesión)", (await kindOf(obtainAccessToken(auth, { now, sleep: noSleep }))) === "network");
}
// Tiempo agotado en la renovación
{
  const auth = fakeAuth(session(60), ["hang"]);
  const token = await obtainAccessToken(auth, { now, sleep: noSleep, attemptTimeoutMs: 20 });
  check("renovación colgada (tiempo agotado): sigue con el token actual", token === "viejo");
}
// Recuperación tras un fallo pasajero
{
  const auth = fakeAuth(session(60), ["net", "net", session(3600, "nuevo")]);
  const token = await obtainAccessToken(auth, { now, sleep: noSleep });
  check("la red vuelve al tercer intento: token nuevo", token === "nuevo" && auth.calls() === 3);
}
// Retroceso: esperas crecientes
{
  const waits: number[] = [];
  const auth = fakeAuth(session(60), ["net"]);
  await kindOf(refreshWithRetry(auth, { sleep: async (ms) => { waits.push(ms); } }));
  check("retroceso creciente entre intentos", waits.length === 3 && waits[0] < waits[1] && waits[1] < waits[2], waits.join("/") + " ms");
}
// Rechazo definitivo → no_session (solo aquí se cierra)
{
  const auth = fakeAuth(session(60), ["reject"]);
  check("token revocado: no_session", (await kindOf(obtainAccessToken(auth, { now, sleep: noSleep }))) === "no_session");
  check("…sin reintentar un rechazo", auth.calls() === 1);
}
{
  const auth = fakeAuth(null, ["net"]);
  check("sin sesión guardada: no_session", (await kindOf(obtainAccessToken(auth, { now, sleep: noSleep }))) === "no_session");
}
// 401 del servidor (forzar renovación) con la red caída → red, no cierre
{
  const auth = fakeAuth(session(3000), ["net"]);
  check("401 del servidor + red caída al renovar: error de red", (await kindOf(obtainAccessToken(auth, { now, sleep: noSleep }, true))) === "network");
}
// Con audio sonando la app no se desmonta aunque Supabase avise SIGNED_OUT
check("SIGNED_OUT con audio sonando: se espera (la canción sigue)", signedOutAction(true) === "wait");
check("SIGNED_OUT sin audio: pantalla de acceso", signedOutAction(false) === "unmount");

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
