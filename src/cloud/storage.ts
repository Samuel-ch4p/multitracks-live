/**
 * Almacenamiento clave-valor de la nube (id del dispositivo, sesión, caché del catálogo en texto).
 * Es una abstracción mínima: la versión de Windows (Electron) llama a `setCloudStorage` con su propia implementación.
 * Aquí NUNCA se guarda audio.
 */
export interface CloudStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const webStorage: CloudStorage = {
  async get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  async set(key, value) { try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ } },
  async remove(key) { try { localStorage.removeItem(key); } catch { /* sin almacenamiento */ } },
};

/** Capacitor Preferences (Android); se importa solo al usarse. */
const capacitorStorage: CloudStorage = {
  async get(key) { const { Preferences } = await import("@capacitor/preferences"); return (await Preferences.get({ key })).value; },
  async set(key, value) { const { Preferences } = await import("@capacitor/preferences"); await Preferences.set({ key, value }); },
  async remove(key) { const { Preferences } = await import("@capacitor/preferences"); await Preferences.remove({ key }); },
};

let current: CloudStorage | null = null;

export function setCloudStorage(storage: CloudStorage) { current = storage; }

export function cloudStorage(): CloudStorage {
  if (!current) {
    const cap = typeof window !== "undefined" ? (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor : undefined;
    current = cap?.isNativePlatform?.() ? capacitorStorage : webStorage;
  }
  return current;
}
