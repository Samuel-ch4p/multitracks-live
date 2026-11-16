// I6: descarga reanudable con Range y reintentos con retroceso exponencial. Servidor simulado (sin red).
// Uso: node tools/verify-resume.ts
import { CloudError } from "../src/cloud/errors.ts";
import { RESUME_BACKOFF_MS, downloadResumable, parseContentRange, type FetchFrom } from "../src/cloud/resumable.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

const SIZE = 10 * 1024 * 1024 + 123; // 10 MB y pico (más de un trozo de 4 MB)
const file = new Uint8Array(SIZE);
for (let i = 0; i < SIZE; i++) file[i] = (i * 31 + 7) & 255;
const other = new Uint8Array(SIZE).fill(9); // "otro archivo" (otra versión subida al servidor)

/** Cuerpo que entrega `bytes` en trozos de 64 KB y, si `cutAfter` está definido, corta la conexión tras ese número de bytes. */
function body(bytes: Uint8Array, cutAfter?: number) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (cutAfter !== undefined && sent >= cutAfter) { controller.error(new TypeError("network error")); return; }
      if (sent >= bytes.length) { controller.close(); return; }
      const end = Math.min(bytes.length, sent + 65536, cutAfter ?? Infinity);
      controller.enqueue(bytes.slice(sent, end));
      sent = end;
    },
  });
}

type Plan = { cutAfter?: number; ignoreRange?: boolean; etag?: string; data?: Uint8Array; failFetch?: boolean };
/** Servidor simulado: cada petición sigue el plan de turno (el último se repite). Registra los offsets pedidos. */
function server(plans: Plan[]) {
  const offsets: number[] = [];
  let n = 0;
  const fetchFrom: FetchFrom = async (offset) => {
    const plan = plans[Math.min(n++, plans.length - 1)];
    offsets.push(offset);
    if (plan.failFetch) throw new CloudError("network", 0, {}, "sin conexión");
    const data = plan.data ?? file;
    const etag = plan.etag ?? '"v1"';
    if (offset > 0 && !plan.ignoreRange) {
      const rest = data.subarray(offset);
      return new Response(body(rest, plan.cutAfter), { status: 206, headers: { "Content-Range": `bytes ${offset}-${data.length - 1}/${data.length}`, "Content-Length": String(rest.length), ETag: etag } });
    }
    return new Response(body(data, plan.cutAfter), { status: 200, headers: { "Content-Length": String(data.length), ETag: etag } });
  };
  return { fetchFrom, offsets };
}

const waits: number[] = [];
const opts = (signal = new AbortController().signal) => ({ expectedSize: SIZE, onProgress: () => {}, signal, sleep: async (ms: number) => { waits.push(ms); } });
const same = async (blob: Blob) => { const b = new Uint8Array(await blob.arrayBuffer()); return b.length === SIZE && b.every((v, i) => v === file[i]); };

check("Content-Range se interpreta", JSON.stringify(parseContentRange("bytes 100-199/1000")) === JSON.stringify({ start: 100, end: 199, total: 1000 }));

{
  const s = server([{}]);
  check("sin cortes: archivo idéntico en una petición", (await same(await downloadResumable(s.fetchFrom, opts()))) && s.offsets.length === 1);
}
{
  const s = server([{ cutAfter: 3_000_000 }, {}]);
  const blob = await downloadResumable(s.fetchFrom, opts());
  check("corte a 3 MB: reanuda con Range desde 3 MB", s.offsets[1] === 3_000_000, `offsets ${s.offsets.join(", ")}`);
  check("…y el archivo final es idéntico byte a byte", await same(blob));
}
{
  const s = server([{ cutAfter: 2_000_000 }, { cutAfter: 3_000_000 }, { cutAfter: 1_000_000 }, {}]);
  const blob = await downloadResumable(s.fetchFrom, opts());
  check("red que va y viene (3 cortes): termina igual, sin volver a empezar", (await same(blob)) && s.offsets.every((o, i) => i === 0 || o > s.offsets[i - 1]), `offsets ${s.offsets.join(", ")}`);
}
{
  const s = server([{ cutAfter: 4_000_000 }, { ignoreRange: true }]);
  const blob = await downloadResumable(s.fetchFrom, opts());
  check("servidor sin Range (responde 200): empieza de cero sin mezclar", await same(blob));
}
{
  const s = server([{ cutAfter: 4_000_000 }, { etag: '"v2"', data: other }, { etag: '"v2"', data: other }]);
  const blob = await downloadResumable(s.fetchFrom, { ...opts(), expectedSize: SIZE });
  const b = new Uint8Array(await blob.arrayBuffer());
  check("el archivo cambió en el servidor (otro ETag): se descarta lo anterior y se baja entero el nuevo", b.length === SIZE && b.every((v) => v === 9));
}
{
  waits.length = 0;
  const s = server([{ cutAfter: 1_000_000 }, { failFetch: true }]);
  let err: unknown = null;
  try { await downloadResumable(s.fetchFrom, opts()); } catch (e) { err = e; }
  check("sin red persistente: se rinde con error de RED", err instanceof CloudError && err.kind === "network");
  check("…tras 6 reintentos con retroceso exponencial", waits.length === RESUME_BACKOFF_MS.length && waits.every((w, i) => i === 0 || w > waits[i - 1]), waits.join("/") + " ms");
}
{
  const controller = new AbortController();
  const s = server([{ cutAfter: 1_000_000 }, {}]);
  let err: unknown = null;
  try { await downloadResumable(s.fetchFrom, { ...opts(controller.signal), onProgress: (r) => { if (r > 500_000) controller.abort(); } }); } catch (e) { err = e; }
  check("cancelar: 'cancelled' y no se reintenta", err instanceof CloudError && err.kind === "cancelled" && s.offsets.length === 1);
}
{
  const s = server([{ cutAfter: 500_000 }, {}]);
  const fetchFrom: FetchFrom = async (offset, signal) => {
    if (offset > 0) throw new CloudError("usage_limit", 429, {}, "daily_limit");
    return s.fetchFrom(offset, signal);
  };
  let err: unknown = null;
  try { await downloadResumable(fetchFrom, opts()); } catch (e) { err = e; }
  check("límite de uso al reanudar: no se insiste (error tal cual)", err instanceof CloudError && err.kind === "usage_limit");
}
{
  // Conexión colgada: no llega nada; el corte por inactividad (stall) dispara la reanudación.
  let n = 0;
  const fetchFrom: FetchFrom = async (offset, signal) => {
    if (n++ === 0) {
      return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(file.slice(0, 100_000)); signal.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError"))); } }), { headers: { "Content-Length": String(SIZE), ETag: '"v1"' } });
    }
    const rest = file.subarray(offset);
    return new Response(body(rest), { status: 206, headers: { "Content-Range": `bytes ${offset}-${SIZE - 1}/${SIZE}`, ETag: '"v1"' } });
  };
  const blob = await downloadResumable(fetchFrom, { ...opts(), stallMs: 50 });
  check("conexión colgada (sin bytes): se corta y se reanuda desde lo recibido", await same(blob));
}

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
