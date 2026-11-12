import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import BrandMark from "./BrandMark";
import { apiGet } from "./cloud/api";
import { currentSession, friendlyAuthMessage, sendPasswordReset, signIn, signOut, signUp, supabase } from "./cloud/auth";
import { CONTACTO_SOPORTE, cloudConfigured, supportHint, whatsappLink } from "./cloud/config";
import { openExternal } from "./externalLink";
import { SupportEmail } from "./CloudParts";
import { LegalScreen } from "./LegalView";
import type { LegalKind } from "./legal";
import { legalSignUpMetadata, saveAcceptance } from "./legalAcceptance";
import { expiredOnStart, startInactivityWatch } from "./inactivity";
import { CloudError, friendlyCloudMessage } from "./cloud/errors";
import "./styles/auth.css";

type Account = { email: string; userId: string; signOut: () => void };
const AccountContext = createContext<Account | null>(null);

/** Cuenta con sesión iniciada (null en desarrollo sin nube configurada). Sirve para el botón "Cerrar sesión". */
// eslint-disable-next-line react-refresh/only-export-components
export const useAccount = () => useContext(AccountContext);

/** Dueño de los datos locales (cultos, sesión). En desarrollo sin nube no hay cuenta: "dev". */
// eslint-disable-next-line react-refresh/only-export-components
export const useUserId = () => useContext(AccountContext)?.userId ?? "dev";

/** En desarrollo sin variables de nube se deja pasar para poder usar el modo demo; en producción nunca. */
const DEV_BYPASS = import.meta.env.DEV && !cloudConfigured;

type Phase =
  | { name: "boot" }
  | { name: "out" }
  | { name: "checking" }
  | { name: "ok" }
  | { name: "problem"; error: CloudError };

/** Solo en desarrollo: ?auth=welcome|in|up|reset|notice|pending|expired|blocked|paused|usage|device|checking muestra esa pantalla de acceso para revisarla. */
const PREVIEW = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("auth") : null;

function AuthPreview({ name }: { name: string }) {
  const noop = () => undefined;
  const kinds: Record<string, CloudError["kind"]> = { pending: "pending", expired: "expired", blocked: "blocked", paused: "paused", usage: "usage_limit", device: "device_limit" };
  if (kinds[name]) return <ProblemScreen error={new CloudError(kinds[name], 403, { expires_at: "2026-03-15T00:00:00Z" })} email="persona@correo.com" onRetry={noop} onSignOut={noop} />;
  if (name === "checking") return <Screen title="Verificando tu cuenta…" busy><div className="auth-spinner" aria-hidden="true" /><p>Un momento.</p></Screen>;
  return <AuthScreen notice={name === "notice"} initialMode={name === "in" || name === "up" || name === "reset" ? name : "in"} onSignedIn={noop} />;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  if (PREVIEW) return <AuthPreview name={PREVIEW} />;
  return <AuthGateInner>{children}</AuthGateInner>;
}

function AuthGateInner({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>(() => (DEV_BYPASS ? { name: "ok" } : { name: "boot" }));
  // Aviso en la pantalla de acceso tras un cierre por ausencia o inactividad.
  const [inactivityNotice, setInactivityNotice] = useState(false);

  /** Cierre local (esta app en este teléfono; no cierra otros dispositivos). No borra cultos ni configuración guardados. */
  const expire = useCallback(async () => {
    await signOut();
    setSession(null);
    setInactivityNotice(true);
    setPhase({ name: "out" });
  }, []);

  // Comprueba la cuenta con la API (el catálogo es la primera petición real; también valida dispositivo y membresía).
  const check = useCallback(async () => {
    setPhase({ name: "checking" });
    try {
      const resp = await apiGet("/catalog");
      await resp.body?.cancel();
      setPhase({ name: "ok" });
    } catch (e) {
      const error = e instanceof CloudError ? e : new CloudError("network");
      if (error.kind === "no_session") { await signOut(); setSession(null); setPhase({ name: "out" }); return; }
      setPhase({ name: "problem", error });
    }
  }, []);

  useEffect(() => {
    if (DEV_BYPASS || !cloudConfigured) return;
    let alive = true;
    void currentSession().then((s) => {
      if (!alive) return;
      setSession(s);
      if (!s) { setPhase({ name: "out" }); return; }
      // Arranque en frío: si se salió hace más de lo permitido, se pide iniciar sesión de nuevo.
      void expiredOnStart().then((expired) => { if (!alive) return; if (expired) void expire(); else void check(); });
    }).catch(() => alive && setPhase({ name: "out" }));
    const { data } = supabase().auth.onAuthStateChange((event, s) => {
      if (!alive) return;
      if (event === "SIGNED_OUT") { setSession(null); setPhase({ name: "out" }); }
      else if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") setSession(s);
    });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, [check, expire]);

  // Con sesión abierta y verificada: vigila ausencia e inactividad (marcas de tiempo, nunca con audio sonando ni descargas).
  const signedIn = phase.name === "ok" && !DEV_BYPASS;
  useEffect(() => {
    if (!signedIn) return;
    return startInactivityWatch(() => void expire());
  }, [signedIn, expire]);

  const account = useMemo<Account | null>(
    () => (session ? { email: session.user.email ?? "", userId: session.user.id, signOut: () => { void signOut().then(() => { setSession(null); setPhase({ name: "out" }); }); } } : null),
    [session]
  );

  if (!DEV_BYPASS && !cloudConfigured) {
    return <Screen chip="SIN CONFIGURAR" title="Nube no configurada"><p>La Nube Crescendo aún no está configurada en esta versión de la app.</p></Screen>;
  }
  if (phase.name === "boot") return null; // el logo de arranque de index.html sigue visible
  if (phase.name === "out") {
    return <AuthScreen notice={inactivityNotice} onSignedIn={(s) => { setInactivityNotice(false); setSession(s); void check(); }} />;
  }
  if (phase.name === "checking") return <Screen title="Verificando tu cuenta…" busy><div className="auth-spinner" aria-hidden="true" /><p>Un momento.</p></Screen>;
  if (phase.name === "problem") {
    return <ProblemScreen error={phase.error} email={session?.user.email ?? ""} onRetry={() => void check()} onSignOut={() => account?.signOut()} />;
  }
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

function Screen({ title, chip, children, busy }: { title: string; chip?: string; children: ReactNode; busy?: boolean }) {
  return (
    <main className="auth-screen">
      <div className="auth-state" aria-busy={busy}>
        <BrandMark className="auth-mark" />
        {chip && <span className="auth-chip">{chip}</span>}
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

function ProblemScreen({ error, email, onRetry, onSignOut }: { error: CloudError; email: string; onRetry: () => void; onSignOut: () => void }) {
  const [chip, title] =
    error.kind === "pending" ? ["PENDIENTE DE ACTIVACIÓN", "Tu cuenta aún no está activa"]
    : error.kind === "expired" ? ["MEMBRESÍA VENCIDA", "Tu membresía venció"]
    : error.kind === "blocked" ? ["CUENTA BLOQUEADA", "Cuenta bloqueada"]
    : error.kind === "paused" ? ["CUENTA EN PAUSA", "Tu cuenta está en pausa"]
    : error.kind === "usage_limit" ? ["USO MÁXIMO", "Uso máximo por ahora"]
    : error.kind === "device_limit" ? ["LÍMITE DE DISPOSITIVOS", "Demasiados dispositivos"]
    : ["SIN VERIFICAR", "No pudimos verificar tu cuenta"];
  const message = error.kind === "pending"
    ? "Estamos revisando tu registro. Cuando tu cuenta esté activa, toca Reintentar."
    : friendlyCloudMessage(error);
  const whatsappLabel = error.kind === "expired" ? "RENOVAR POR WHATSAPP" : "ESCRIBIR POR WHATSAPP";
  return (
    <Screen chip={chip} title={title}>
      <p>{message}</p>
      {error.kind === "pending" && email && <div className="auth-email"><span>Cuenta registrada</span><strong>{email}</strong></div>}
      <div className="auth-actions">
        {error.showsSupport && (
          <button className="auth-primary" onClick={() => void openExternal(whatsappLink(supportMessage(error.kind, email)))}>{whatsappLabel}</button>
        )}
        <button className={error.showsSupport ? "auth-secondary" : "auth-primary"} onClick={onRetry}>REINTENTAR</button>
        <button className="auth-link" onClick={onSignOut}>Cerrar sesión</button>
      </div>
      {error.showsSupport
        ? <p className="auth-contact">WhatsApp {CONTACTO_SOPORTE.whatsappDisplay}</p>
        : <p className="auth-hint">{supportHint()}</p>}
      {(error.kind === "pending" || error.kind === "paused" || error.kind === "blocked") && <SupportEmail lead="Correo de soporte:" />}
    </Screen>
  );
}

/** Mensaje de WhatsApp según el caso; incluye el correo de la sesión cuando se conoce. */
function supportMessage(kind: CloudError["kind"], email: string): string {
  const account = email ? ` (${email})` : "";
  if (kind === "pending") return `Hola, creé mi cuenta en Crescendo Live${email ? ` con el correo ${email}` : ""} y quiero activar mi membresía.`;
  if (kind === "expired") return email ? `Hola, quiero renovar mi membresía de Crescendo Live. Mi correo es ${email}.` : "Hola, quiero renovar mi membresía de Crescendo Live.";
  if (kind === "paused") return `Hola, mi cuenta de Crescendo Live${account} aparece en pausa por uso inusual. ¿Me pueden ayudar?`;
  if (kind === "usage_limit") return `Hola, alcancé el uso máximo en Crescendo Live${account} y necesito ayuda.`;
  if (kind === "blocked") return `Hola, mi cuenta de Crescendo Live${account} aparece bloqueada. ¿Me pueden ayudar?`;
  return `Hola, mi cuenta de Crescendo Live${account} llegó al límite de dispositivos y quiero cambiar de dispositivo.`;
}

type Mode = "in" | "up" | "reset";

/** Al enfocar un campo, se desplaza para quedar visible sobre el teclado (la pantalla se encoge cuando el teclado se abre); el formulario es el que se desplaza. */
function keepFocusedVisible(event: React.FocusEvent<HTMLFormElement>) {
  const field = event.target;
  if (!(field instanceof HTMLInputElement)) return;
  window.setTimeout(() => field.scrollIntoView({ block: "center", behavior: "smooth" }), 350);
}

const MIN_PASSWORD = 8;

/** Campo de contraseña con botón de ver/ocultar (zona táctil de 44 px) y mensaje opcional bajo el campo. */
function PasswordField({ label, hint, value, onChange, autoComplete, invalid, message, messageId, showLabel, hideLabel }: {
  label: string; hint?: string; value: string; onChange: (value: string) => void; autoComplete: string; invalid?: boolean; message?: string; messageId: string; showLabel: string; hideLabel: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={`${messageId}-input`}>
        <span>{label}</span>
        {hint && <em className={invalid ? "is-bad" : ""}>{hint}</em>}
      </label>
      <span className="auth-pass">
        <input id={`${messageId}-input`} type={shown ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={message ? messageId : undefined} />
        <button type="button" className="auth-show" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-label={shown ? hideLabel : showLabel}>{shown ? "Ocultar" : "Ver"}</button>
      </span>
      {message && <p className="auth-field-error" id={messageId} role="alert">{message}</p>}
    </div>
  );
}

function AuthScreen({ onSignedIn, notice, initialMode = "in" }: { onSignedIn: (session: Session) => void; notice: boolean; initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [legal, setLegal] = useState<LegalKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  function go(next: Mode) {
    setMode(next);
    setError("");
    setInfo("");
    setConfirm("");
  }

  const mismatch = mode === "up" && confirm.length > 0 && confirm !== password;
  const tooShort = mode === "up" && password.length > 0 && password.length < MIN_PASSWORD;
  /** Crear cuenta: sin campos vacíos, contraseña válida y confirmación igual; también mientras haya un error mostrado (se limpia al editar). */
  const signUpBlocked = mode === "up" && (!email.trim() || !password || !confirm || tooShort || mismatch || !accepted || Boolean(error));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setInfo("");
    if (!email.trim()) { setError("Escribe tu correo."); return; }
    if (mode !== "reset" && password.length < MIN_PASSWORD) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (mode === "up" && (confirm !== password || !accepted)) return; // el mensaje "Las contraseñas no coinciden" ya se ve bajo el campo
    setBusy(true);
    try {
      if (mode === "reset") {
        await sendPasswordReset(email);
        setInfo("Si el correo está registrado, te enviamos un mensaje para cambiar la contraseña.");
      } else if (mode === "up") {
        const now = new Date();
        const hasSession = await signUp(email, password, legalSignUpMetadata(now)); // la aceptación viaja a Supabase en options.data
        saveAcceptance(now); // solo si signUp no lanzó error: versión y fecha en este dispositivo
        if (!hasSession) { setInfo("Cuenta creada. Confirma tu correo desde el mensaje que te enviamos y luego inicia sesión."); setMode("in"); setConfirm(""); }
      } else {
        await signIn(email, password);
      }
      const s = mode === "reset" ? null : await currentSession();
      if (s) onSignedIn(s);
    } catch (e) {
      setError(friendlyAuthMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const clearError = () => { if (error) setError(""); };
  const primary = busy ? "UN MOMENTO…" : mode === "in" ? "ENTRAR" : mode === "up" ? "CREAR CUENTA" : "ENVIAR CORREO";
  return (
    <main className="auth-screen">
      <div className="auth-shell">
        <section className="auth-brand">
          <BrandMark className="auth-mark" />
          <h1>Tu servicio, con cada pista en su lugar.</h1>
          <p>Biblioteca de multitracks, mezclador y click en un solo lugar.</p>
          {mode === "up" && <p className="auth-brand-lead">Tu cuenta quedará pendiente hasta que la activemos.</p>}
          <footer className="auth-foot"><SupportEmail lead="¿Necesitas ayuda?" /></footer>
        </section>
        <form className="auth-card" onSubmit={(e) => void submit(e)} noValidate onFocus={keepFocusedVisible} aria-label={mode === "in" ? "Iniciar sesión" : mode === "up" ? "Crear cuenta" : "Recuperar contraseña"}>
          {mode === "reset" ? (
            <header className="auth-head">
              <button type="button" className="auth-back" aria-label="Volver a iniciar sesión" onClick={() => go("in")}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
              </button>
              <div><h2>Recuperar contraseña</h2><p>Te enviaremos un enlace para elegir una contraseña nueva.</p></div>
            </header>
          ) : (
            <div className="auth-tabs" role="tablist" aria-label="Acceso">
              <button type="button" role="tab" aria-selected={mode === "in"} className={mode === "in" ? "selected" : ""} onClick={() => go("in")}>Iniciar sesión</button>
              <button type="button" role="tab" aria-selected={mode === "up"} className={mode === "up" ? "selected" : ""} onClick={() => go("up")}>Crear cuenta</button>
            </div>
          )}
          <div className="auth-body">
            {mode === "up" && <p className="auth-lead">Tu cuenta quedará pendiente hasta que la activemos.</p>}
            <div className="auth-field">
              <label className="auth-label" htmlFor="auth-email"><span>Correo</span></label>
              <input id="auth-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => { setEmail(e.target.value); clearError(); }} />
            </div>
            {mode !== "reset" && (
              <PasswordField
                label="Contraseña" hint={mode === "up" ? "Mínimo 8 caracteres" : undefined} invalid={tooShort}
                value={password} onChange={(v) => { setPassword(v); clearError(); }} autoComplete={mode === "up" ? "new-password" : "current-password"}
                messageId="auth-pass" showLabel="Mostrar contraseña" hideLabel="Ocultar contraseña"
              />
            )}
            {mode === "up" && (
              <PasswordField
                label="Confirmar contraseña" value={confirm} onChange={(v) => { setConfirm(v); clearError(); }} autoComplete="new-password" invalid={mismatch}
                message={mismatch ? "Las contraseñas no coinciden" : undefined} messageId="auth-confirm" showLabel="Mostrar confirmación de contraseña" hideLabel="Ocultar confirmación de contraseña"
              />
            )}
            {mode === "up" && (
              <label className="auth-check">
                <input type="checkbox" checked={accepted} onChange={(e) => { setAccepted(e.target.checked); clearError(); }} aria-label="Acepto los Términos y la Política de privacidad. Soy mayor de 18 años, o tengo autorización de mi padre, madre o representante legal" />
                <span>
                  Soy mayor de 18 años, o tengo autorización de mi padre, madre o representante legal, y acepto los{" "}
                  <button type="button" className="auth-inline" onClick={() => setLegal("terms")}>Términos</button> y la{" "}
                  <button type="button" className="auth-inline" onClick={() => setLegal("privacy")}>Política de privacidad</button>
                </span>
              </label>
            )}
            {notice && !error && !info && <p className="auth-info" role="status">Cerramos tu sesión por inactividad</p>}
            {error && <p className="auth-error" role="alert">{error}</p>}
            {info && <p className="auth-info" role="status">{info}</p>}
            <button className="auth-primary" type="submit" disabled={busy || signUpBlocked}>{primary}</button>
            {mode === "in" && <button type="button" className="auth-link" onClick={() => go("reset")}>Olvidé mi contraseña</button>}
          </div>
        </form>
      </div>
      {legal && <LegalScreen kind={legal} onClose={() => setLegal(null)} />}
    </main>
  );
}
