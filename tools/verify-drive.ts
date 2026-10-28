// Verifica driveSource.ts con un Drive simulado (sin red): paginación, filtrado, orden, descarga con Range y errores.
// Uso: node tools/verify-drive.ts
import {
  DriveError, FOLDER_MIME, downloadFile, friendlyDriveMessage, listArtists, listChildren, listSongs, sortByName,
  type DriveConfig,
} from "../src/driveSource.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

// ---- Drive simulado: raíz con 2500 elementos (3 páginas de 1000) ----
type Item = { id: string; name: string; mimeType: string; size?: string };
const root: Item[] = [];
for (let i = 0; i < 118; i++) root.push({ id: `art${i}`, name: `Artista ${String(i).padStart(3, "0")}`, mimeType: FOLDER_MIME });
root.push({ id: "artB1", name: "bethel MUSIC", mimeType: FOLDER_MIME }, { id: "artB2", name: "Bethel", mimeType: FOLDER_MIME });
root.push({ id: "artU1", name: "Un Corazon", mimeType: FOLDER_MIME }, { id: "artU2", name: "UN CORAZÓN", mimeType: FOLDER_MIME });
root.push({ id: "artA", name: "Álvaro", mimeType: FOLDER_MIME }, { id: "artZ", name: "Zeta", mimeType: FOLDER_MIME });
for (let i = 0; i < 2300; i++) root.push({ id: `loose${i}`, name: `suelto ${i}.${i % 2 ? "rar" : "zip"}`, mimeType: "application/zip" });
const artistFolder: Item[] = [
  { id: "z1", name: "Cancion B.zip", mimeType: "application/zip", size: "1000" },
  { id: "z2", name: "canción a - D - 145bpm.ZIP", mimeType: "application/zip", size: "2000" },
  { id: "x1", name: "portada.jpg", mimeType: "image/jpeg" },
  { id: "x2", name: "notas.rar", mimeType: "application/x-rar" },
  { id: "f1", name: "Subcarpeta", mimeType: FOLDER_MIME },
];

const calls: URL[] = [];
const listFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  calls.push(url);
  const q = url.searchParams.get("q") ?? "";
  const parent = /'([^']+)' in parents/.exec(q)?.[1];
  const all = parent === "ROOT" ? root : parent === "ART" ? artistFolder : [];
  const size = Number(url.searchParams.get("pageSize"));
  const start = Number(url.searchParams.get("pageToken") ?? 0);
  const files = all.slice(start, start + size);
  const body = { files, ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) };
  return new Response(JSON.stringify(body), { status: 200 });
};
const cfg: DriveConfig = { apiKey: "KEY", fetchImpl: listFetch };

const children = await listChildren("ROOT", cfg);
check("paginación completa (2424 elementos en 3 páginas)", children.length === root.length && calls.length === 3, `${children.length} elementos, ${calls.length} consultas`);
check("consulta con q, fields mínimos, pageSize=1000 y llave", calls[0].searchParams.get("pageSize") === "1000" && /trashed=false/.test(calls[0].searchParams.get("q")!) && /nextPageToken/.test(calls[0].searchParams.get("fields")!) && calls[0].searchParams.get("key") === "KEY");
check("usa la API (no enlaces de drive.google.com)", calls.every((u) => u.hostname === "www.googleapis.com"));

const artists = await listArtists("ROOT", cfg);
check("artistas = solo carpetas (124), se ignoran .rar/.zip sueltos", artists.length === 124 && artists.every((a) => !/suelto/.test(a.name)), `${artists.length}`);
check("orden sin distinguir mayúsculas ni acentos (Álvaro antes de Artista)", artists[0].name === "Álvaro", artists.slice(0, 3).map((a) => a.name).join(" | "));
check("no se fusionan variantes (Bethel / bethel MUSIC / Un Corazon / UN CORAZÓN siguen separadas)",
  ["Bethel", "bethel MUSIC", "Un Corazon", "UN CORAZÓN"].every((n) => artists.some((a) => a.name === n)));
check("Zeta al final", artists[artists.length - 1].name === "Zeta");

const songs = await listSongs("ART", cfg);
check("canciones = solo .zip (sin jpg, rar ni carpetas), insensible a mayúsculas", songs.length === 2 && songs.every((s) => /\.zip$/i.test(s.name)));
check("canciones ordenadas por nombre con acentos", songs[0].name.startsWith("canción a") && songs[1].name === "Cancion B.zip", songs.map((s) => s.name).join(" | "));
check("tamaño numérico", songs[0].size === 2000);
check("sortByName: números en orden natural", sortByName([{ name: "Pista 10" }, { name: "pista 2" }]).map((x) => x.name).join() === "pista 2,Pista 10");

// ---- Descarga con Range ----
const data = new Uint8Array(10 * 1024 * 1024 + 12345).map((_, i) => (i * 7 + (i >> 8)) & 255);
const file = { id: "dl", name: "x.zip", mimeType: "application/zip", size: data.length };
const mkServer = (opts: { quotaOnce?: boolean; noRange?: boolean; status?: number; reason?: string } = {}) => {
  let quotaSent = false;
  let requests = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    requests++;
    const range = new Headers(init?.headers).get("Range");
    if (opts.status) return new Response(JSON.stringify({ error: { errors: [{ reason: opts.reason ?? "" }] } }), { status: opts.status });
    if (opts.quotaOnce && !quotaSent) { quotaSent = true; return new Response(JSON.stringify({ error: { errors: [{ reason: "rateLimitExceeded" }] } }), { status: 403 }); }
    if (opts.noRange || !range) return new Response(data, { status: 200 });
    const [a, b] = /bytes=(\d+)-(\d+)/.exec(range)!.slice(1).map(Number);
    return new Response(data.slice(a, b + 1), { status: 206 });
  };
  return { fetchImpl, count: () => requests };
};
const same = async (blob: Blob) => {
  const got = new Uint8Array(await blob.arrayBuffer());
  return got.length === data.length && got.every((v, i) => v === data[i]);
};

{
  const server = mkServer();
  let last = 0, monotonic = true;
  const blob = await downloadFile(file, (r, t) => { if (r < 0 || t !== data.length) monotonic = false; last = Math.max(last, r); }, { apiKey: "KEY", fetchImpl: server.fetchImpl }, { chunk: 1024 * 1024 });
  check("descarga con Range en 11 trozos: contenido idéntico", await same(blob), `${server.count()} peticiones`);
  check("progreso real hasta el 100 %", monotonic && last === data.length);
}
{
  const server = mkServer({ quotaOnce: true });
  const blob = await downloadFile(file, () => {}, { apiKey: "KEY", fetchImpl: server.fetchImpl }, { chunk: 4 * 1024 * 1024 });
  check("cuota (403 rateLimitExceeded) una vez → reintenta y completa", await same(blob));
}
{
  const server = mkServer({ noRange: true });
  const blob = await downloadFile(file, () => {}, { apiKey: "KEY", fetchImpl: server.fetchImpl }, { chunk: 1024 * 1024 });
  check("servidor sin Range (200 completo) → descarga continua", await same(blob));
}
for (const [status, reason, kind] of [[404, "notFound", "notfound"], [403, "downloadQuotaExceeded", "quota"], [403, "forbidden", "forbidden"], [429, "", "quota"]] as const) {
  const server = mkServer({ status, reason });
  let err: unknown = null;
  const t0 = Date.now();
  try { await downloadFile(file, () => {}, { apiKey: "KEY", fetchImpl: server.fetchImpl }, { chunk: 16 * 1024 * 1024, connections: 1 }); } catch (e) { err = e; }
  const msg = friendlyDriveMessage(err);
  check(`error ${status}/${reason} → ${kind}, mensaje amable`, err instanceof DriveError && err.kind === kind && /intenta en unos minutos/.test(msg), `${msg}${kind === "quota" ? ` (${Date.now() - t0} ms de reintentos)` : ""}`);
}
{
  let err: unknown = null;
  try { await listChildren("ROOT", { apiKey: "", fetchImpl: listFetch }); } catch (e) { err = e; }
  check("sin llave → error de configuración, sin romper", err instanceof DriveError && err.kind === "config" && /configurada/.test(friendlyDriveMessage(err)));
}
{
  const down: typeof fetch = async () => { throw new TypeError("Failed to fetch"); };
  let err: unknown = null;
  try { await listChildren("ROOT", { apiKey: "K", fetchImpl: down }); } catch (e) { err = e; }
  check("sin red → mensaje de conexión", /conexión/.test(friendlyDriveMessage(err)));
}

console.log(failed ? `\n${failed} comprobaciones FALLARON` : "\nTodas las comprobaciones pasaron");
process.exit(failed ? 1 : 0);
