import { CloudError } from "./errors.ts";

/**
 * Descarga reanudable (I6). Si la conexión se corta a mitad, se pide el resto con `Range: bytes=<recibido>-` y se sigue desde ahí.
 * Solo se acepta la continuación si el servidor responde 206 empezando justo donde se quedó y es el MISMO archivo (mismo ETag);
 * si no (200, otro ETag o un rango distinto), se empieza de cero sin mezclar datos. El Worker ya admite Range (/file → 206).
 *
 * Reintentos: retroceso exponencial (1, 2, 4, 8, 16, 30 s) contado en fallos SEGUIDOS sin avanzar; cada vez que llegan bytes nuevos
 * la cuenta vuelve a empezar (una red que va y viene termina igual la descarga). Cada continuación es una petición nueva al servidor,
 * pero el límite cuenta canciones DISTINTAS, así que reanudar no gasta cupo.
 * Módulo sin dependencias del navegador más allá de fetch/Blob: se prueba en tools/verify-resume.ts.
 */

export type FetchFrom = (offset: number, signal: AbortSignal) => Promise<Response>;

export type ResumeOptions = {
  /** Tamaño esperado (del catálogo) si el servidor no manda Content-Length. */
  expectedSize: number;
  onProgress: (received: number, total: number) => void;
  /** Cancelación del usuario. */
  signal: AbortSignal;
  /** Sin bytes durante este tiempo = conexión colgada (se corta y se reanuda). */
  stallMs?: number;
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
};

export const RESUME_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const CHUNK = 4 * 1024 * 1024;

/** "bytes 100-199/1000" → { start: 100, end: 199, total: 1000 }. */
export function parseContentRange(value: string | null): { start: number; end: number; total: number | null } | null {
  const m = value?.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), total: m[3] === "*" ? null : Number(m[3]) };
}

const isRetriable = (e: unknown) =>
  (e instanceof CloudError && (e.kind === "network" || e.kind === "server")) || (e instanceof TypeError) || (e instanceof Error && e.name === "AbortError");

export async function downloadResumable(fetchFrom: FetchFrom, options: ResumeOptions): Promise<Blob> {
  const backoff = options.backoffMs ?? RESUME_BACKOFF_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const stallMs = options.stallMs ?? 30000;
  const user = options.signal;

  let parts: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let received = 0;
  let total = options.expectedSize > 0 ? options.expectedSize : 0;
  let etag: string | null = null;
  let failures = 0;

  const flush = () => { if (pending.length) { parts.push(new Blob(pending as BlobPart[])); pending = []; pendingBytes = 0; } };
  const restart = () => { parts = []; pending = []; pendingBytes = 0; received = 0; };

  for (;;) {
    if (user.aborted) throw new CloudError("cancelled");
    const attempt = new AbortController();
    const relay = () => attempt.abort();
    user.addEventListener("abort", relay);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => attempt.abort(), stallMs); };
    const startedAt = received;
    try {
      arm();
      let resp = await fetchFrom(received, attempt.signal);
      if (received > 0) {
        const range = parseContentRange(resp.headers.get("Content-Range"));
        const respTag = resp.headers.get("ETag");
        const sameFile = !etag || !respTag || respTag === etag;
        const continues = resp.status === 206 && !!range && range.start === received && sameFile;
        if (!continues) {
          // No se puede continuar sin riesgo de mezclar: se empieza de cero.
          restart();
          if (!(resp.status === 200 && sameFile)) {
            await resp.body?.cancel();
            resp = await fetchFrom(0, attempt.signal);
          }
        }
      }
      if (received === 0) {
        etag = resp.headers.get("ETag");
        const range = parseContentRange(resp.headers.get("Content-Range"));
        const length = Number(resp.headers.get("Content-Length"));
        if (range?.total) total = range.total;
        else if (resp.status === 200 && length > 0) total = length;
      }
      if (!resp.body) throw new CloudError("other", resp.status, {}, "sin cuerpo");
      const reader = resp.body.getReader();
      for (;;) {
        arm();
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (e) {
          if (user.aborted) throw new CloudError("cancelled");
          throw new CloudError("network", 0, {}, e instanceof Error ? e.message : "red");
        }
        if (chunk.done) break;
        pending.push(chunk.value);
        pendingBytes += chunk.value.length;
        received += chunk.value.length;
        options.onProgress(received, total);
        if (pendingBytes >= CHUNK) flush();
      }
      flush();
      if (total > 0 && received > total) { restart(); throw new CloudError("network", 0, {}, "tamaño inesperado"); }
      if (total > 0 && received < total) throw new CloudError("network", 0, {}, "descarga incompleta");
      clearTimeout(timer);
      user.removeEventListener("abort", relay);
      return new Blob(parts, { type: "application/zip" });
    } catch (e) {
      clearTimeout(timer);
      user.removeEventListener("abort", relay);
      flush(); // lo recibido hasta el corte se conserva para reanudar
      if (user.aborted) throw new CloudError("cancelled");
      const stalled = attempt.signal.aborted;
      if (!stalled && !isRetriable(e)) throw e;
      failures = received > startedAt ? 1 : failures + 1;
      if (failures > backoff.length) throw new CloudError("network", 0, {}, stalled ? "sin datos" : "no se pudo completar la descarga");
      await sleep(backoff[failures - 1]);
    }
  }
}
