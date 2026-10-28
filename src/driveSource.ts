/**
 * Nube Crescendo sobre Google Drive (API v3 con llave; la carpeta raíz es pública por enlace, solo lectura).
 * Estructura: Raíz/<Artista>/<Canción>.zip.  Solo metadatos y descargas; nada se guarda en el dispositivo.
 * Todo recibe `cfg` para poder probarse con un `fetch` simulado (tools/verify-drive.ts).
 */
export const FOLDER_MIME = "application/vnd.google-apps.folder";
// VITE_DRIVE_API_BASE solo se usa en pruebas locales con un Drive simulado.
const API = (import.meta.env?.VITE_DRIVE_API_BASE as string | undefined) || "https://www.googleapis.com/drive/v3";

export type DriveFile = { id: string; name: string; mimeType: string; size?: number; modifiedTime?: string };

export type DriveConfig = { apiKey: string; fetchImpl?: typeof fetch };

export type DriveErrorKind = "quota" | "notfound" | "forbidden" | "network" | "config" | "other";

export class DriveError extends Error {
  kind: DriveErrorKind;
  status: number;
  constructor(kind: DriveErrorKind, status: number, message: string) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

/** Mensaje para el usuario: nunca técnico ni con nombres de servicios. */
export function friendlyDriveMessage(error: unknown): string {
  if (error instanceof DriveError) {
    if (error.kind === "config") return "La Nube Crescendo aún no está configurada en esta versión de la app.";
    if (error.kind === "network") return "No pudimos conectar con la Nube Crescendo. Comprueba tu conexión.";
    return "No se pudo descargar ahora, intenta en unos minutos.";
  }
  if (error instanceof RangeError) return "Este multitrack es demasiado grande para la memoria del dispositivo. Cierra otras apps e inténtalo de nuevo.";
  const message = error instanceof Error ? error.message : "";
  if (/failed to fetch|network|load failed|abort|timeout/i.test(message)) return "No pudimos conectar con la Nube Crescendo. Comprueba tu conexión.";
  return "No se pudo descargar ahora, intenta en unos minutos.";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Minúsculas, sin acentos (para ordenar y buscar). */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Orden por nombre sin distinguir mayúsculas ni acentos (y con números en orden natural). */
export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => foldText(a.name).localeCompare(foldText(b.name), "es", { numeric: true, sensitivity: "base" }));
}

const fetchOf = (cfg: DriveConfig) => cfg.fetchImpl ?? fetch.bind(globalThis);

/** Convierte una respuesta de error de la API en DriveError (distingue cuota de otros 403). */
async function errorFrom(resp: Response): Promise<DriveError> {
  let reason = "";
  try {
    const body = (await resp.json()) as { error?: { errors?: { reason?: string }[]; status?: string } };
    reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? "";
  } catch {
    // sin cuerpo útil
  }
  if (resp.status === 429 || /ratelimit|quota|dailylimit|resource_exhausted/i.test(reason)) return new DriveError("quota", resp.status, `cuota: ${reason}`);
  if (resp.status === 404) return new DriveError("notfound", 404, "archivo no disponible");
  if (resp.status === 403) return new DriveError("forbidden", 403, `prohibido: ${reason}`);
  if (resp.status === 400 || resp.status === 401) return new DriveError("config", resp.status, `llave o petición inválida: ${reason}`);
  return new DriveError("other", resp.status, `estado ${resp.status}`);
}

/** Se reintenta cuota, red, errores 5xx y respuestas truncadas; no archivos inexistentes, prohibidos ni llave inválida. */
const retryable = (error: unknown) =>
  error instanceof DriveError ? error.kind === "quota" || error.kind === "network" || error.kind === "other" : true;

async function getJson<T>(url: string, cfg: DriveConfig, attempts = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      let resp: Response;
      try {
        resp = await fetchOf(cfg)(url, { cache: "no-store" });
      } catch (e) {
        throw new DriveError("network", 0, e instanceof Error ? e.message : "red");
      }
      if (!resp.ok) throw await errorFrom(resp);
      return (await resp.json()) as T;
    } catch (e) {
      if (attempt >= attempts - 1 || !retryable(e)) throw e;
      await sleep(500 * 2 ** attempt);
    }
  }
}

type ListResponse = { nextPageToken?: string; files?: { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }[] };

/** Todos los hijos de una carpeta (pageSize 1000, con paginación completa). */
export async function listChildren(folderId: string, cfg: DriveConfig): Promise<DriveFile[]> {
  if (!cfg.apiKey) throw new DriveError("config", 0, "sin llave de API");
  const out: DriveFile[] = [];
  let token: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId.replace(/['\\]/g, "")}' in parents and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime)",
      pageSize: "1000",
      key: cfg.apiKey,
    });
    if (token) params.set("pageToken", token);
    const page = await getJson<ListResponse>(`${API}/files?${params}`, cfg);
    for (const f of page.files ?? []) {
      out.push({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size ? Number(f.size) : undefined, modifiedTime: f.modifiedTime });
    }
    token = page.nextPageToken;
  } while (token);
  return out;
}

/** Artistas = SOLO carpetas de la raíz (los .rar/.zip sueltos se ignoran). No se fusiona ni renombra nada. */
export async function listArtists(rootId: string, cfg: DriveConfig): Promise<DriveFile[]> {
  return sortByName((await listChildren(rootId, cfg)).filter((f) => f.mimeType === FOLDER_MIME));
}

/** Canciones de un artista = SOLO archivos .zip. */
export async function listSongs(artistId: string, cfg: DriveConfig): Promise<DriveFile[]> {
  return sortByName((await listChildren(artistId, cfg)).filter((f) => f.mimeType !== FOLDER_MIME && /\.zip$/i.test(f.name)));
}

// ---------- Descarga rápida con Range ----------
const CHUNK = 4 * 1024 * 1024;
const CONNECTIONS = 8; // Drive limita por usuario: más conexiones no aceleran y sí disparan errores de cuota
const STALL_MS = 20000;

/**
 * Baja un archivo por trozos de 4 MB con varias conexiones a la vez. Cada trozo se guarda como parte de un Blob:
 * no hace falta un bloque enorme de memoria ni una segunda copia al final, y el ZIP se lee luego por tramos.
 * Reintenta cada trozo; si el servidor no admite Range (responde 200 completo) cae a una descarga continua.
 */
export async function downloadFile(
  file: DriveFile,
  onProgress: (received: number, total: number) => void,
  cfg: DriveConfig,
  options: { chunk?: number; connections?: number; signal?: AbortSignal } = {}
): Promise<Blob> {
  if (!cfg.apiKey) throw new DriveError("config", 0, "sin llave de API");
  const chunkSize = options.chunk ?? CHUNK;
  const url = `${API}/files/${encodeURIComponent(file.id)}?alt=media&key=${encodeURIComponent(cfg.apiKey)}`;
  let size = file.size;
  if (!size) {
    const meta = await getJson<{ size?: string }>(`${API}/files/${encodeURIComponent(file.id)}?fields=size&key=${encodeURIComponent(cfg.apiKey)}`, cfg);
    size = meta.size ? Number(meta.size) : 0;
  }
  if (!size) throw new DriveError("notfound", 404, "archivo vacío o no disponible");

  const total = Math.ceil(size / chunkSize);
  const parts: Blob[] = new Array(total);
  let received = 0;
  let next = 0;
  let failure: unknown = null;
  let rangeUnsupported = false;

  const fetchChunk = async (index: number) => {
    const start = index * chunkSize;
    const end = Math.min(size, start + chunkSize) - 1;
    for (let attempt = 0; ; attempt++) {
      let got = 0;
      const controller = new AbortController();
      const relay = () => controller.abort();
      options.signal?.addEventListener("abort", relay);
      let stall = setTimeout(() => controller.abort(), STALL_MS);
      try {
        let resp: Response;
        try {
          resp = await fetchOf(cfg)(url, { headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal, cache: "no-store" });
        } catch (e) {
          if (options.signal?.aborted) throw e;
          throw new DriveError("network", 0, e instanceof Error ? e.message : "red");
        }
        if (resp.status === 200 && total > 1) { rangeUnsupported = true; throw new DriveError("other", 200, "sin Range"); }
        if (!resp.ok && resp.status !== 206) throw await errorFrom(resp);
        if (!resp.body) throw new DriveError("other", resp.status, "sin cuerpo");
        const reader = resp.body.getReader();
        const pieces: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          clearTimeout(stall);
          stall = setTimeout(() => controller.abort(), STALL_MS);
          if (done) break;
          got += value.length;
          if (got > end - start + 1) throw new DriveError("other", 0, "respuesta demasiado larga");
          pieces.push(value);
          received += value.length;
          onProgress(received, size);
        }
        if (got !== end - start + 1) throw new DriveError("other", 0, "trozo incompleto");
        parts[index] = new Blob(pieces as BlobPart[]);
        return;
      } catch (e) {
        received -= got;
        if (options.signal?.aborted || rangeUnsupported) throw e;
        if (attempt >= 4 || !retryable(e)) throw e;
        await sleep(600 * 2 ** attempt);
      } finally {
        clearTimeout(stall);
        options.signal?.removeEventListener("abort", relay);
      }
    }
  };

  const worker = async () => {
    while (!failure && next < total) {
      const index = next++;
      try { await fetchChunk(index); } catch (e) { failure = e; return; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.connections ?? CONNECTIONS, total) }, worker));

  if (rangeUnsupported) return downloadWhole(url, size, onProgress, cfg, options.signal);
  if (failure) throw failure;
  return new Blob(parts, { type: "application/zip" });
}

/** Respaldo: una sola descarga continua guardada en trozos de 4 MB. */
async function downloadWhole(url: string, size: number, onProgress: (r: number, t: number) => void, cfg: DriveConfig, signal?: AbortSignal): Promise<Blob> {
  let resp: Response;
  try {
    resp = await fetchOf(cfg)(url, { signal, cache: "no-store" });
  } catch (e) {
    throw new DriveError("network", 0, e instanceof Error ? e.message : "red");
  }
  if (!resp.ok || !resp.body) throw await errorFrom(resp);
  const reader = resp.body.getReader();
  const parts: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending.push(value);
    pendingBytes += value.length;
    received += value.length;
    onProgress(received, size);
    if (pendingBytes >= CHUNK) { parts.push(new Blob(pending as BlobPart[])); pending = []; pendingBytes = 0; }
  }
  if (pending.length) parts.push(new Blob(pending as BlobPart[]));
  if (received !== size) throw new DriveError("other", 0, "descarga incompleta");
  return new Blob(parts, { type: "application/zip" });
}
