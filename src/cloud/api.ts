import { API_URL, cloudConfigured } from "./config";
import { getAccessToken, supabase } from "./auth";
import { getDeviceId, getDeviceLabel } from "./device";
import { CloudError, errorFromResponse } from "./errors";

/** Cabeceras que exige cada ruta de la API (sesión + dispositivo). */
export async function authHeaders(forceRefresh = false): Promise<Record<string, string>> {
  if (!cloudConfigured) throw new CloudError("config");
  if (forceRefresh) {
    const { data, error } = await supabase().auth.refreshSession();
    if (error || !data.session) throw new CloudError("no_session");
  }
  const [token, id, label] = await Promise.all([getAccessToken(), getDeviceId(), getDeviceLabel()]);
  return { Authorization: `Bearer ${token}`, "X-Device-Id": id, "X-Device-Label": label };
}

export const apiUrl = (path: string) => `${API_URL}${path}`;

/** GET autenticado. Ante un 401 intenta refrescar el token una vez; si falla, CloudError("no_session"). 304 se devuelve tal cual. */
export async function apiGet(path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const headers = { ...(init.headers as Record<string, string> | undefined), ...(await authHeaders(attempt > 0)) };
    let resp: Response;
    try {
      resp = await fetch(apiUrl(path), { ...init, headers, cache: "no-store" });
    } catch (e) {
      if (init.signal?.aborted) throw new CloudError("cancelled");
      throw new CloudError("network", 0, {}, e instanceof Error ? e.message : "red");
    }
    if (resp.status === 401 && attempt === 0) { await resp.body?.cancel(); continue; }
    if (!resp.ok && resp.status !== 304) throw await errorFromResponse(resp);
    return resp;
  }
}
