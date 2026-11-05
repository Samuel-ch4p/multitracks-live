import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, cloudConfigured } from "./config";
import { CloudError } from "./errors";
import { cloudStorage } from "./storage";

let client: SupabaseClient | null = null;

/** Cliente de Supabase (sesión persistente y refresco automático del token). Solo con la clave publishable. */
export function supabase(): SupabaseClient {
  if (!cloudConfigured) throw new CloudError("config");
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "crescendo.auth.v1",
        storage: {
          getItem: (key) => cloudStorage().get(key),
          setItem: (key, value) => cloudStorage().set(key, value),
          removeItem: (key) => cloudStorage().remove(key),
        },
      },
    });
  }
  return client;
}

export async function currentSession(): Promise<Session | null> {
  const { data } = await supabase().auth.getSession();
  return data.session;
}

/** Texto en español para los errores de inicio de sesión / registro (sin exponer detalles técnicos). */
export function friendlyAuthMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (/invalid login|invalid credentials/i.test(raw)) return "Correo o contraseña incorrectos.";
  if (/already registered|already been registered/i.test(raw)) return "Ese correo ya tiene una cuenta. Inicia sesión.";
  if (/email not confirmed/i.test(raw)) return "Confirma tu correo desde el mensaje que te enviamos y vuelve a entrar.";
  if (/password.*(short|least|weak)/i.test(raw)) return "La contraseña es demasiado corta o débil (mínimo 8 caracteres).";
  if (/invalid.*email|valid email/i.test(raw)) return "Escribe un correo válido.";
  if (/rate limit|too many/i.test(raw)) return "Demasiados intentos. Espera unos minutos.";
  if (/fetch|network/i.test(raw)) return "No pudimos conectar. Comprueba tu conexión.";
  return "No se pudo completar. Intenta de nuevo.";
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

/** Devuelve true si hay sesión de inmediato; false si Supabase pide confirmar el correo primero. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await supabase().auth.signUp({ email: email.trim(), password });
  if (error) throw error;
  return !!data.session;
}

export async function signOut() {
  try { await supabase().auth.signOut({ scope: "local" }); } catch { /* ya cerrada */ }
}

export async function sendPasswordReset(email: string) {
  const { error } = await supabase().auth.resetPasswordForEmail(email.trim());
  if (error) throw error;
}

/** Token listo para usar: si faltan menos de 5 minutos para expirar, lo refresca antes. */
export async function getAccessToken(): Promise<string> {
  const session = await currentSession();
  if (!session) throw new CloudError("no_session");
  const left = (session.expires_at ?? 0) - Date.now() / 1000;
  if (left < 300) {
    const { data, error } = await supabase().auth.refreshSession();
    if (error || !data.session) throw new CloudError("no_session");
    return data.session.access_token;
  }
  return session.access_token;
}
