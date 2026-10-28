/**
 * Fuente de la "Nube Crescendo".
 * - "drive" (por defecto): carpeta compartida de Google Drive leída con la API (driveSource.ts).
 * - "mega": la fuente anterior (MegaBrowser.tsx), conservada como respaldo.
 * Para volver al respaldo: poner VITE_CLOUD_SOURCE=mega en .env (o cambiar DEFAULT_SOURCE aquí).
 */
export type CloudSource = "drive" | "mega";

const DEFAULT_SOURCE: CloudSource = "drive";

export const CLOUD_SOURCE: CloudSource =
  (import.meta.env.VITE_CLOUD_SOURCE as string | undefined) === "mega" ? "mega"
    : (import.meta.env.VITE_CLOUD_SOURCE as string | undefined) === "drive" ? "drive"
      : DEFAULT_SOURCE;

/** Llave de API (solo Drive API) e ID de la carpeta raíz. Vienen de .env (VITE_DRIVE_API_KEY, VITE_DRIVE_ROOT_ID). */
export const DRIVE_API_KEY = ((import.meta.env.VITE_DRIVE_API_KEY as string | undefined) ?? "").trim();
export const DRIVE_ROOT_ID = ((import.meta.env.VITE_DRIVE_ROOT_ID as string | undefined) ?? "").trim();
