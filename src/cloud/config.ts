/**
 * Configuración de la nube propia de Crescendo. Los tres valores se inyectan en el build (VITE_*); en el código no hay ninguna clave.
 * Solo se usa la clave "publishable" de Supabase (pública por diseño); nunca service_role ni secret.
 */
const clean = (value: string | undefined) => (value ?? "").trim().replace(/\/+$/, "");

export const API_URL = clean(import.meta.env.VITE_CRESCENDO_API_URL);
export const SUPABASE_URL = clean(import.meta.env.VITE_SUPABASE_URL);
export const SUPABASE_PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

export const cloudConfigured = !!API_URL && !!SUPABASE_URL && !!SUPABASE_PUBLISHABLE_KEY;

/** Datos de soporte: ÚNICO lugar donde se escriben. Todo lo demás (botones, enlaces, textos) sale de aquí. */
export const CONTACTO_SOPORTE = {
  /** Formato internacional sin signos, para https://wa.me/ */
  whatsappNumber: "573127664740",
  /** Cómo se muestra en pantalla */
  whatsappDisplay: "+57 312 766 4740",
  email: "chaparrosamuel86@gmail.com",
} as const;

/** Enlace de WhatsApp con el mensaje ya escrito. */
export const whatsappLink = (message: string) => `https://wa.me/${CONTACTO_SOPORTE.whatsappNumber}?text=${encodeURIComponent(message)}`;

/** Enlace para escribir un correo a soporte. */
export const mailtoLink = (subject: string, body = "") =>
  `mailto:${CONTACTO_SOPORTE.email}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ""}`;

/** Línea discreta para errores que no se resuelven reintentando. */
export const supportHint = () => `Si el problema continúa, escríbenos a ${CONTACTO_SOPORTE.email}.`;

/**
 * Cierre de sesión por ausencia e inactividad. Se mide con marcas de tiempo guardadas, no con temporizadores
 * (en Android el WebView se suspende en segundo plano y los temporizadores se congelan). Ver inactivity.ts.
 */
/** Minutos fuera de la app (sin audio sonando al salir) tras los cuales se pide iniciar sesión de nuevo. */
export const GRACIA_FUERA_MIN = 10;
/** Minutos sin interacción y sin audio (en primer plano), o fuera de la app con audio al salir, tras los cuales se cierra la sesión. */
export const INACTIVIDAD_MIN = 60;
