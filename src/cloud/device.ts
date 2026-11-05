import { cloudStorage } from "./storage";

const KEY = "crescendo.deviceId.v1";
let cached: string | null = null;

function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** UUID estable del dispositivo: se crea una sola vez y se guarda. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const store = cloudStorage();
  let id = await store.get(KEY);
  if (!id || id.length < 8) {
    id = newId();
    await store.set(KEY, id);
  }
  cached = id;
  return id;
}

/** Texto corto para el administrador (p. ej. "Android SM-A546B"). Solo informativo. */
export async function getDeviceLabel(): Promise<string> {
  try {
    const ua = navigator.userAgent;
    const platform = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() ?? "web";
    const model = ua.match(/Android[^;)]*;\s*([^;)]+?)(?:\sBuild|\))/)?.[1]?.trim();
    const label = platform === "android" ? `Android${model ? ` ${model}` : ""}` : platform === "ios" ? "iOS" : /Windows/.test(ua) ? "Windows" : "Web";
    return label.slice(0, 60);
  } catch {
    return "Dispositivo";
  }
}
