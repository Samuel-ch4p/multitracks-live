import { LEGAL_VERSION } from "./legal";

/**
 * Aceptación de la Política de privacidad y los Términos al crear la cuenta. Por ahora solo se guarda en este dispositivo:
 * la versión del texto aceptada y la fecha. Con la versión se puede volver a pedir la aceptación si el texto cambia (needsAcceptance).
 */
const KEY = "crescendo-legal-accepted-v1";

export type LegalAcceptance = { version: string; acceptedAt: string };

export function loadAcceptance(): LegalAcceptance | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LegalAcceptance>;
    return typeof value.version === "string" && typeof value.acceptedAt === "string" ? { version: value.version, acceptedAt: value.acceptedAt } : null;
  } catch {
    return null;
  }
}

/** Guarda la versión vigente y la fecha de hoy (AAAA-MM-DD). */
export function saveAcceptance(now = new Date()): LegalAcceptance {
  const acceptance = { version: LEGAL_VERSION, acceptedAt: now.toISOString().slice(0, 10) };
  try { localStorage.setItem(KEY, JSON.stringify(acceptance)); } catch { /* sin almacenamiento: solo vale para esta sesión */ }
  return acceptance;
}

/** true si nunca se aceptó o si el texto cambió desde la versión aceptada. */
export const needsAcceptance = () => loadAcceptance()?.version !== LEGAL_VERSION;
