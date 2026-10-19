/**
 * Descifrado de archivos de MEGA con el motor nativo del teléfono (WebCrypto).
 * La librería megajs lo hace en JavaScript y además verifica la integridad: en un celular es lo que más tarda.
 * Los archivos de MEGA usan AES-128-CTR: la clave es la mitad 1 XOR la mitad 2 de la clave del archivo,
 * y el contador empieza con 8 bytes de nonce + 8 bytes de número de bloque.
 */
const PART = 16 * 1024 * 1024; // múltiplo de 16

export const canDecryptNative = (key: unknown): key is Uint8Array =>
  typeof crypto !== "undefined" && !!crypto.subtle && key instanceof Uint8Array && key.length === 32;

export async function decryptMega(
  data: Uint8Array,
  key: Uint8Array,
  onProgress?: (done: number, total: number) => void,
  partSize = PART
): Promise<Uint8Array> {
  const raw = new Uint8Array(16);
  for (let i = 0; i < 16; i++) raw[i] = key[i] ^ key[16 + i];
  const aes = await crypto.subtle.importKey("raw", raw, "AES-CTR", false, ["decrypt"]);
  const counter = new Uint8Array(16);
  counter.set(key.subarray(16, 24), 0);
  const view = new DataView(counter.buffer);
  for (let offset = 0; offset < data.length; offset += partSize) {
    view.setBigUint64(8, BigInt(offset / 16));
    const part = data.subarray(offset, Math.min(data.length, offset + partSize));
    const plain = await crypto.subtle.decrypt({ name: "AES-CTR", counter, length: 64 }, aes, part as BufferSource);
    data.set(new Uint8Array(plain), offset); // se escribe sobre el mismo arreglo para no duplicar memoria
    onProgress?.(Math.min(data.length, offset + partSize), data.length);
  }
  return data;
}

type ApiNode = {
  size?: number;
  key?: unknown;
  nodeId?: string;
  downloadId?: string | string[];
  api: { request: (req: Record<string, unknown>, cb: (err: Error | null, res: { g?: string; s?: number }) => void) => void };
};

const CHUNK = 4 * 1024 * 1024; // múltiplo de 16
const CONNECTIONS = 24;
const STALL_MS = 20000; // sin recibir un solo byte durante este tiempo, la conexión se considera caída

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Descarga propia: pide la dirección una sola vez y baja trozos de 4 MB por 24 conexiones a la vez,
 * escribiendo cada uno directo en su lugar de la memoria y descifrándolo apenas llega
 * (la descarga y el descifrado se solapan; no pasa por la emulación de streams de la librería).
 */
export async function fastDownload(
  item: ApiNode,
  onProgress: (received: number, total: number) => void
): Promise<Uint8Array> {
  const key = item.key as Uint8Array;
  const req: Record<string, unknown> = { a: "g", g: 1, ssl: 2 };
  if (item.nodeId) req.n = item.nodeId;
  else if (Array.isArray(item.downloadId)) { req._querystring = { n: item.downloadId[0] }; req.n = item.downloadId[1]; }
  else req.p = item.downloadId;

  const res = await new Promise<{ g?: string; s?: number }>((resolve, reject) =>
    item.api.request(req, (err, r) => (err ? reject(err) : resolve(r)))
  );
  if (typeof res.g !== "string" || !res.g.startsWith("http") || !res.s) throw new Error("La nube no entregó la descarga.");
  const url = res.g;
  const size = res.s;
  const out = new Uint8Array(size);

  const raw = new Uint8Array(16);
  for (let i = 0; i < 16; i++) raw[i] = key[i] ^ key[16 + i];
  const aes = await crypto.subtle.importKey("raw", raw, "AES-CTR", false, ["decrypt"]);
  const decryptAt = async (start: number, end: number) => {
    const counter = new Uint8Array(16);
    counter.set(key.subarray(16, 24), 0);
    new DataView(counter.buffer).setBigUint64(8, BigInt(start / 16));
    const plain = await crypto.subtle.decrypt({ name: "AES-CTR", counter, length: 64 }, aes, out.subarray(start, end) as BufferSource);
    out.set(new Uint8Array(plain), start);
  };

  let received = 0;
  const total = Math.ceil(size / CHUNK);
  let next = 0;
  let failed: Error | null = null;

  const fetchChunk = async (index: number) => {
    const start = index * CHUNK;
    const end = Math.min(size, start + CHUNK);
    for (let attempt = 0; ; attempt++) {
      let got = start;
      // Si la conexión se queda colgada sin cortarse, se aborta y el trozo se reintenta (antes la descarga podía quedar congelada).
      const controller = new AbortController();
      let stall = setTimeout(() => controller.abort(), STALL_MS);
      try {
        // no-store: el navegador no debe dejar copias de la descarga en su caché del teléfono.
        const resp = await fetch(`${url}/${start}-${end - 1}`, { signal: controller.signal, cache: "no-store" });
        if (resp.status === 509) throw Object.assign(new Error("Bandwidth limit reached"), { fatal: true });
        if (!resp.ok || !resp.body) throw new Error(`status ${resp.status}`);
        const reader = resp.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          clearTimeout(stall);
          stall = setTimeout(() => controller.abort(), STALL_MS);
          if (done) break;
          if (got + value.length > end) throw new Error("respuesta demasiado larga");
          out.set(value, got);
          got += value.length;
          received += value.length;
          onProgress(received, size);
        }
        if (got !== end) throw new Error("trozo incompleto");
        await decryptAt(start, end);
        return;
      } catch (e) {
        received -= got - start; // se vuelve a bajar el trozo completo
        if ((e as { fatal?: boolean }).fatal || attempt >= 4) throw e;
        await sleep(400 * (attempt + 1));
      } finally {
        clearTimeout(stall);
      }
    }
  };

  const worker = async () => {
    while (!failed && next < total) {
      const index = next++;
      try { await fetchChunk(index); } catch (e) { failed = e as Error; return; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONNECTIONS, total) }, worker));
  if (failed) throw failed;
  return out;
}
