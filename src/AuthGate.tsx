import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import BrandMark from "./BrandMark";
import { apiGet } from "./cloud/api";
import { currentSession, friendlyAuthMessage, sendPasswordReset, signIn, signOut, signUp, supabase } from "./cloud/auth";
import { CONTACTO_SOPORTE, cloudConfigured } from "./cloud/config";
import { CloudError, friendlyCloudMessage } from "./cloud/errors";
import "./styles/auth.css";

type Account = { email: string; signOut: () => void };
const AccountContext = createContext<Account | null>(null);

/** Cuenta con sesión iniciada (null en desarrollo sin nube configurada). Sirve para el botón "Cerrar sesión". */
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
    return <Screen title="Nube no configurada"><p>La Nube Crescendo aún no está configurada en esta versión de la app.</p></Screen>;
  }
  if (phase.name === "boot") return null; // el logo de arranque de index.html sigue visible
  if (phase.name === "out") {
    return <AuthScreen onSignedIn={(s) => { setSession(s); void check(); }} />;
  }
  if (phase.name === "checking") return <Screen title="Verificando tu cuenta…" busy><p>Un momento.</p></Screen>;
  if (phase.name === "problem") return <ProblemScreen error={phase.error} onRetry={() => void check()} onSignOut={() => account?.signOut()} />;
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

function Screen({ title, children, busy }: { title: string; children: ReactNode; busy?: boolean }) {
  return (
    <main className="auth-screen">
      <div className="auth-card" aria-busy={busy}>
        <BrandMark className="auth-mark" />
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

function ProblemScreen({ error, onRetry, onSignOut }: { error: CloudError; onRetry: () => void; onSignOut: () => void }) {
  const title =
    error.kind === "pending" ? "Tu cuenta aún no está activa"
    : error.kind === "expired" ? "Membresía vencida"
    : error.kind === "blocked" ? "Cuenta bloqueada"
    : error.kind === "device_limit" ? "Demasiados dispositivos"
    : "No pudimos verificar tu cuenta";
  const message = error.kind === "pending"
    ? "Estamos revisando tu registro. Cuando tu cuenta esté activa, toca Reintentar."
    : friendlyCloudMessage(error);
  return (
    <Screen title={title}>
      <p>{message}</p>
      {error.isAccountState && <p className="auth-contact">{CONTACTO_SOPORTE}</p>}
      <button className="auth-primary" onClick={onRetry}>REINTENTAR</button>
      <button className="auth-link" onClick={onSignOut}>Cerrar sesión</button>
    </Screen>
  );
}

function AuthScreen({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

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

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={(e) => void submit(e)} noValidate>
        <BrandMark className="auth-mark" />
        <h1>{mode === "in" ? "Iniciar sesión" : mode === "up" ? "Crear cuenta" : "Recuperar contraseña"}</h1>
        <label>
          <span>Correo</span>
          <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== "reset" && (
          <label>
            <span>Contraseña</span>
            <input type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {info && <p className="auth-info" role="status">{info}</p>}
        <button className="auth-primary" type="submit" disabled={busy}>
          {busy ? "UN MOMENTO…" : mode === "in" ? "ENTRAR" : mode === "up" ? "CREAR CUENTA" : "ENVIAR CORREO"}
        </button>
        {mode === "in" && <button type="button" className="auth-link" onClick={() => { setMode("reset"); setError(""); setInfo(""); }}>Olvidé mi contraseña</button>}
        <button type="button" className="auth-link" onClick={() => { setMode(mode === "up" ? "in" : mode === "in" ? "up" : "in"); setError(""); setInfo(""); }}>
          {mode === "in" ? "No tengo cuenta · Crear una" : "Ya tengo cuenta · Iniciar sesión"}
        </button>
        {mode === "up" && <p className="auth-note">Tu cuenta quedará pendiente hasta que la activemos.</p>}
      </form>
    </main>
  );
}
