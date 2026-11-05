/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CRESCENDO_API_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  // Temporales, se eliminan en la fase 4:
  readonly VITE_DRIVE_API_KEY?: string;
  readonly VITE_DRIVE_ROOT_ID?: string;
  readonly VITE_CLOUD_SOURCE?: string;
  readonly VITE_DRIVE_API_BASE?: string;
}
