import { CloudError } from "./errors.ts";

const CHUNK = 4 * 1024 * 1024;

/**
 * Lee el cuerpo de la respuesta en streaming hacia un Blob, informando el avance.
 * Verifica que el total recibido coincida con lo anunciado (Content-Length o tamaño del catálogo).
 */
export async function readBodyToBlob(
  resp: Response,
  expectedSize: number,
  onProgress: (received: number, total: number) => void,
  signal: AbortSignal,
  stall: { arm: () => void; clear: () => void } = { arm() {}, clear() {} }
): Promise<Blob> {
  if (!resp.body) throw new CloudError("other", resp.status, {}, "sin cuerpo");
  const announced = Number(resp.headers.get("Content-Length"));
  const total = announced > 0 ? announced : expectedSize;
  const reader = resp.body.getReader();
  const parts: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let received = 0;
  try {
    for (;;) {
      stall.arm();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (signal.aborted) throw new CloudError("cancelled");
        throw new CloudError("network", 0, {}, e instanceof Error ? e.message : "red");
      }
      if (chunk.done) break;
      pending.push(chunk.value);
      pendingBytes += chunk.value.length;
      received += chunk.value.length;
      onProgress(received, total);
      if (pendingBytes >= CHUNK) { parts.push(new Blob(pending as BlobPart[])); pending = []; pendingBytes = 0; }
    }
  } finally {
    stall.clear();
  }
  if (pending.length) parts.push(new Blob(pending as BlobPart[]));
  if (signal.aborted) throw new CloudError("cancelled");
  if (total > 0 && received !== total) throw new CloudError("network", 0, {}, "descarga incompleta");
  return new Blob(parts, { type: "application/zip" });
}
