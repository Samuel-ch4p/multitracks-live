import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import BrandMark from "./BrandMark";
import { apiGet } from "./cloud/api";
import { currentSession, friendlyAuthMessage, sendPasswordReset, signIn, signOut, signUp, supabase } from "./cloud/auth";
import { CONTACTO_SOPORTE, cloudConfigured, supportHint, whatsappLink } from "./cloud/config";
import { openExternal } from "./externalLink";
import { CloudError, friendlyCloudMessage } from "./cloud/errors";
import "./styles/auth.css";

type Account = { email: string; signOut: () => void };
const AccountContext = createContext<Account | null>(null);

/** Cuenta con sesión iniciada (null en desarrollo sin nube configurada). Sirve para el botón "Cerrar sesión". */
// eslint-disable-next-line react-refresh/only-export-components
export const useAccount = () => useContext(AccountContext);

/** En desarrollo sin variables de nube se deja pasar para poder usar el modo demo; en producción nunca. */
const DEV_BYPASS = import.meta.env.DEV && !cloudConfigured;

type Phase =
  | { name: "boot" }
  | { name: "out" }
  | { name: "checking" }
  | { name: "ok" }
  | { name: "problem"; error: CloudError };

export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>(() => (DEV_BYPASS ? { name: "ok" } : { name: "boot" }));

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
      if (s) void check(); else setPhase({ name: "out" });
    }).catch(() => alive && setPhase({ name: "out" }));
    const { data } = supabase().auth.onAuthStateChange((event, s) => {
      if (!alive) return;
      if (event === "SIGNED_OUT") { setSession(null); setPhase({ name: "out" }); }
      else if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") setSession(s);
    });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, [check]);

  const account = useMemo<Account | null>(
    () => (session ? { email: session.user.email ?? "", signOut: () => { void signOut().then(() => { setSession(null); setPhase({ name: "out" }); }); } } : null),
    [session]
  );

  if (!DEV_BYPASS && !cloudConfigured) {
    return <Screen chip="SIN CONFIGURAR" title="Nube no configurada"><p>La Nube Crescendo aún no está configurada en esta versión de la app.</p></Screen>;
  }
  if (phase.name === "boot") return null; // el logo de arranque de index.html sigue visible
  if (phase.name === "out") {
    return <AuthScreen onSignedIn={(s) => { setSession(s); void check(); }} />;
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
        {error.isAccountState && (
          <button className="auth-primary" onClick={() => void openExternal(whatsappLink(supportMessage(error.kind, email)))}>{whatsappLabel}</button>
        )}
        <button className={error.isAccountState ? "auth-secondary" : "auth-primary"} onClick={onRetry}>REINTENTAR</button>
        <button className="auth-link" onClick={onSignOut}>Cerrar sesión</button>
      </div>
      {error.isAccountState
        ? <p className="auth-contact">WhatsApp {CONTACTO_SOPORTE.whatsappDisplay}</p>
        : <p className="auth-hint">{supportHint()}</p>}
    </Screen>
  );
}

/** Mensaje de WhatsApp según el caso; incluye el correo de la sesión cuando se conoce. */
function supportMessage(kind: CloudError["kind"], email: string): string {
  const account = email ? ` (${email})` : "";
  if (kind === "pending") return `Hola, creé mi cuenta en Crescendo Live${email ? ` con el correo ${email}` : ""} y quiero activar mi membresía.`;
  if (kind === "expired") return email ? `Hola, quiero renovar mi membresía de Crescendo Live. Mi correo es ${email}.` : "Hola, quiero renovar mi membresía de Crescendo Live.";
  if (kind === "blocked") return `Hola, mi cuenta de Crescendo Live${account} aparece bloqueada. ¿Me pueden ayudar?`;
  return `Hola, mi cuenta de Crescendo Live${account} llegó al límite de dispositivos y quiero cambiar de dispositivo.`;
}

/** Ilustración de la bienvenida: onda y tres faders. Solo decoración (sin animación). */
function WelcomeArt() {
  const bars = [30, 52, 38, 70, 46, 82, 58, 40, 74, 50, 90, 62, 44, 78, 54, 36, 66, 48, 28, 56];
  const faders = [62, 38, 78];
  return (
    <div className="welcome-art" aria-hidden="true">
      <div className="art-wave">{bars.map((h, i) => <i key={i} className={i < 9 ? "played" : ""} style={{ height: `${h}%` }} />)}</div>
      <div className="art-faders">
        {faders.map((v, i) => (
          <span key={i}><i style={{ height: `${v}%` }} /><b style={{ bottom: `${v}%` }} /></span>
        ))}
      </div>
    </div>
  );
}

type Mode = "welcome" | "in" | "up" | "reset";

function AuthScreen({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [mode, setMode] = useState<Mode>("welcome");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  function go(next: Mode) {
    setMode(next);
    setError("");
    setInfo("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setInfo("");
    if (!email.trim()) { setError("Escribe tu correo."); return; }
    if (mode !== "reset" && password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    setBusy(true);
    try {
      if (mode === "reset") {
        await sendPasswordReset(email);
        setInfo("Si el correo está registrado, te enviamos un mensaje para cambiar la contraseña.");
      } else if (mode === "up") {
        const hasSession = await signUp(email, password);
        if (!hasSession) { setInfo("Cuenta creada. Confirma tu correo desde el mensaje que te enviamos y luego inicia sesión."); setMode("in"); }
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

  if (mode === "welcome") {
    return (
      <main className="auth-screen">
        <div className="welcome">
          <div className="welcome-copy">
            <BrandMark className="auth-mark" />
            <span className="auth-eyebrow">MULTITRACKS EN VIVO</span>
            <h1>Tu servicio, con cada pista en su lugar.</h1>
            <p>Biblioteca de multitracks, mezclador y click en un solo lugar.</p>
            <div className="auth-actions">
              <button className="auth-primary" onClick={() => go("in")}>INICIAR SESIÓN</button>
              <button className="auth-secondary" onClick={() => go("up")}>CREAR CUENTA</button>
            </div>
            <small className="auth-caption">Acceso seguro · Crescendo Live</small>
          </div>
          <WelcomeArt />
        </div>
      </main>
    );
  }

  const title = mode === "in" ? "Iniciar sesión" : mode === "up" ? "Crear cuenta" : "Recuperar contraseña";
  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={(e) => void submit(e)} noValidate>
        <header className="auth-head">
          <button type="button" className="auth-back" aria-label="Volver" onClick={() => go("welcome")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <BrandMark className="auth-mark small" />
          <span className="auth-eyebrow">CRESCENDO LIVE</span>
          <h1>{title}</h1>
          {mode === "up" && <p>Tu cuenta quedará pendiente hasta que la activemos.</p>}
          {mode === "reset" && <p>Te enviaremos un enlace para elegir una contraseña nueva.</p>}
        </header>
        <div className="auth-body">
          <label className="auth-field">
            <span>Correo</span>
            <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {mode !== "reset" && (
            <label className="auth-field">
              <span>Contraseña</span>
              <span className="auth-pass">
                <input type={show ? "text" : "password"} autoComplete={mode === "up" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="auth-show" onClick={() => setShow((v) => !v)} aria-pressed={show}>{show ? "Ocultar" : "Ver"}</button>
              </span>
            </label>
          )}
          {error && <p className="auth-error" role="alert">{error}</p>}
          {info && <p className="auth-info" role="status">{info}</p>}
          <button className="auth-primary" type="submit" disabled={busy}>
            {busy ? "UN MOMENTO…" : mode === "in" ? "ENTRAR" : mode === "up" ? "CREAR CUENTA" : "ENVIAR CORREO"}
          </button>
          <div className="auth-links">
            {mode === "in" && <button type="button" className="auth-link" onClick={() => go("reset")}>Olvidé mi contraseña</button>}
            <button type="button" className="auth-link" onClick={() => go(mode === "in" ? "up" : "in")}>
              {mode === "in" ? "No tengo cuenta · Crear una" : "Ya tengo cuenta · Iniciar sesión"}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
