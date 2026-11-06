// Verifica el contrato de la nube sin red: errores de la API → mensajes en español, y la lectura en streaming de la descarga.
// Uso: node tools/verify-cloud.ts
import { CloudError, errorFromResponse, friendlyCloudMessage } from "../src/cloud/errors.ts";
import { readBodyToBlob } from "../src/cloud/stream.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};
const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const cases: [string, number, object, string, RegExp][] = [
  ["401 no_session", 401, { error: "no_session" }, "no_session", /sesión/],
  ["403 not_active", 403, { error: "not_active" }, "pending", /no está activa/],
  ["403 not_member", 403, { error: "not_member" }, "pending", /no está activa/],
  ["403 expired", 403, { error: "expired", expires_at: "2026-03-15T00:00:00Z" }, "expired", /venció el .*2026/],
  ["403 blocked", 403, { error: "blocked" }, "blocked", /bloqueada/],
  ["403 device_limit", 403, { error: "device_limit", max_devices: 2 }, "device_limit", /máximo de dispositivos/],
  ["403 paused", 403, { error: "paused" }, "paused", /en pausa por uso inusual. Escríbenos por soporte./],
  ["429 daily_limit", 429, { error: "daily_limit", daily_limit: 5 }, "usage_limit", /uso máximo por ahora. Inténtalo más tarde o escríbenos por soporte./],
  ["429 monthly_limit", 429, { error: "monthly_limit", monthly_limit: 50 }, "usage_limit", /uso máximo por ahora/],
  ["403 daily_limit (sin 429)", 403, { error: "daily_limit" }, "usage_limit", /uso máximo por ahora/],
  ["403 monthly_limit (sin 429)", 403, { error: "monthly_limit" }, "usage_limit", /uso máximo por ahora/],
  ["429 sin motivo", 429, {}, "usage_limit", /uso máximo por ahora/],
  ["404 not_found", 404, { error: "not_found" }, "not_found", /no está disponible/],
  ["404 catalog_missing", 404, { error: "catalog_missing" }, "not_found", /no está disponible/],
  ["502 server_error", 502, { error: "server_error" }, "server", /problema/],
  ["400 bad_device", 400, { error: "bad_device" }, "other", /No se pudo/],
];
for (const [name, status, body, kind, text] of cases) {
  const e = await errorFromResponse(json(status, body));
  const msg = friendlyCloudMessage(e);
  check(`${name} → ${kind}`, e.kind === kind && text.test(msg), msg);
  check(`${name}: mensaje sin jerga ni servicios`, !/drive|mega|supabase|worker|r2|http|json/i.test(msg));
  if (kind === "usage_limit" || kind === "paused" || kind === "device_limit") check(`${name}: sin números ni contadores`, !/[0-9]/.test(msg), msg);
}
check("cuerpo no JSON no rompe", (await errorFromResponse(new Response("x", { status: 503 }))).kind === "server");
check("estados de cuenta", (await errorFromResponse(json(403, { error: "expired" }))).isAccountState && !(await errorFromResponse(json(429, { error: "daily_limit" }))).isAccountState);
check("cuenta en pausa es estado de cuenta con soporte", (await errorFromResponse(json(403, { error: "paused" }))).isAccountState && (await errorFromResponse(json(403, { error: "paused" }))).showsSupport);
check("límite de uso ofrece soporte y corta la cola", (await errorFromResponse(json(429, {}))).showsSupport && (await errorFromResponse(json(429, {}))).blocksAll);

// ---- Lectura en streaming ----
const bytes = new Uint8Array(10 * 1024 * 1024).map((_, i) => i % 251);
const streamOf = (data: Uint8Array, chunk = 65536) => new ReadableStream<Uint8Array>({
  start(c) { for (let i = 0; i < data.length; i += chunk) c.enqueue(data.subarray(i, Math.min(data.length, i + chunk))); c.close(); },
});
{
  const progress: number[] = [];
  const blob = await readBodyToBlob(new Response(streamOf(bytes), { headers: { "Content-Length": String(bytes.length) } }), 0, (r) => progress.push(r), new AbortController().signal);
  const back = new Uint8Array(await blob.arrayBuffer());
  check("descarga: contenido idéntico", back.length === bytes.length && back[123456] === bytes[123456] && back[bytes.length - 1] === bytes[bytes.length - 1]);
  check("descarga: progreso creciente hasta el total", progress[progress.length - 1] === bytes.length && progress.every((v, i) => i === 0 || v >= progress[i - 1]));
}
{
  let err: unknown = null;
  try { await readBodyToBlob(new Response(streamOf(bytes.subarray(0, 1000)), { headers: { "Content-Length": "5000" } }), 0, () => {}, new AbortController().signal); } catch (e) { err = e; }
  check("descarga truncada → error de red", err instanceof CloudError && err.kind === "network");
}
{
  const controller = new AbortController();
  let err: unknown = null;
  try {
    await readBodyToBlob(new Response(streamOf(bytes)), bytes.length, () => controller.abort(), controller.signal);
  } catch (e) { err = e; }
  check("cancelar → error 'cancelled'", err instanceof CloudError && err.kind === "cancelled");
}
{
  const blob = await readBodyToBlob(new Response(streamOf(bytes.subarray(0, 4096))), 4096, () => {}, new AbortController().signal);
  check("sin Content-Length usa el tamaño del catálogo", blob.size === 4096);
}

console.log(failed ? `\n${failed} comprobaciones FALLARON` : "\nTodas las comprobaciones pasaron");
process.exit(failed ? 1 : 0);
