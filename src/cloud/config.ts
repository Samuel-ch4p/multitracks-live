/**
 * Configuración de la nube propia de Crescendo. Los tres valores se inyectan en el build (VITE_*); en el código no hay ninguna clave.
 * Solo se usa la clave "publishable" de Supabase (pública por diseño); nunca service_role ni secret.
 */
const clean = (value: string | undefined) => (value ?? "").trim().replace(/\/+$/, "");

export const API_URL = clean(import.meta.env.VITE_CRESCENDO_API_URL);
export const SUPABASE_URL = clean(import.meta.env.VITE_SUPABASE_URL);
export const SUPABASE_PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

export const cloudConfigured = !!API_URL && !!SUPABASE_URL && !!SUPABASE_PUBLISHABLE_KEY;

/** Datos de contacto que se muestran en las pantallas de cuenta. Cámbialos aquí. */
export const CONTACTO_SOPORTE = "Escríbenos por WhatsApp al +00 000 000 0000 o a soporte@ejemplo.com";
