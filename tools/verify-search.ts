// Verifica el buscador (normalización, varias palabras, índice con concurrencia) y las etiquetas de tono/BPM.
// Uso: node tools/verify-search.ts
import { ageLabel, buildIndex, foldQuery, loadIndex, queryTokens, saveIndex, searchIndex, type IndexData } from "../src/searchIndex.ts";
import { parseSongTags } from "../src/songTags.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

// ---- Normalización ----
check("sin acentos ni mayúsculas, guiones y puntos como espacio", foldQuery("  UN  CORAZÓN – Gracias_Dios.zip ") === "un corazon gracias dios zip", foldQuery("  UN  CORAZÓN – Gracias_Dios.zip "));
check("varias palabras", queryTokens("Bethel   Music-Goodness").join("|") === "bethel|music|goodness");

// ---- Índice de prueba ----
const artists = ["Bethel", "bethel MUSIC", "Un Corazon", "UN CORAZÓN", "Su Presencia", "Elevation Worship", "Hillsong United"].map((name, i) => ({ id: `a${i}`, name }));
const songsBy: Record<string, string[]> = {
  a0: ["Goodness of God - Ab - 66bpm.zip", "Raise a Hallelujah.zip"],
  a1: ["Goodness of God.zip", "No Longer Slaves Bb 68.zip"],
  a2: ["Él es Dios - D - 120bpm.zip", "Cielos Abiertos.zip"],
  a3: ["Un Corazón Agradecido.zip"],
  a4: ["Cerca De Mi Bb 105.zip", "Algo Nuevo Empezó - D - 145bpm.zip"],
  a5: ["Graves Into Gardens.zip"],
  a6: ["Oceans (Where Feet May Fail).zip", "Who You Say I Am.zip"],
};
let running = 0, maxRunning = 0;
const fetchSongs = async (artist: { id: string }) => {
  running++; maxRunning = Math.max(maxRunning, running);
  await new Promise((r) => setTimeout(r, 15));
  running--;
  return (songsBy[artist.id] ?? []).map((name, i) => ({ id: `${artist.id}-${i}`, name, size: 1000 + i }));
};
const progress: number[] = [];
const index: IndexData = await buildIndex("ROOT", async () => artists, fetchSongs, { concurrency: 6, onProgress: (d) => progress.push(d) });
check("índice: todas las canciones indexadas con artista", index.songs.length === 12 && index.songs.every((s) => s.artist && s.artistId), `${index.songs.length} canciones`);
check("índice: solo metadatos (id, nombre, artista, tamaño)", index.songs.every((s) => Object.keys(s).every((k) => ["id", "name", "artistId", "artist", "size"].includes(k))));
check("índice: concurrencia limitada a 6 consultas simultáneas", maxRunning <= 6 && maxRunning > 1, `máximo ${maxRunning}`);
check("índice: progreso discreto de 0 a total", progress[0] === 0 && progress[progress.length - 1] === artists.length && progress.every((v, i) => i === 0 || v >= progress[i - 1]));

// ---- Búsqueda ----
const names = (r: ReturnType<typeof searchIndex>) => r.songs.map((s) => s.name).join(" | ");
check("acentos: 'corazon' encuentra 'Un Corazón' y 'Un Corazon' (artistas)", searchIndex(index, "corazon").artists.length === 2);
check("acentos y mayúsculas: 'ÉL ES DIOS'", searchIndex(index, "ÉL ES DIOS").songs.length === 1 && searchIndex(index, "el es dios").songs.length === 1);
check("varias palabras (todas deben coincidir): 'goodness bethel' → las dos de Bethel", searchIndex(index, "goodness bethel").songs.length === 2, names(searchIndex(index, "goodness bethel")));
check("varias palabras sin coincidencia común → vacío", searchIndex(index, "goodness elevation").songs.length === 0);
check("guiones y espacios: 'goodness-of god' y 'GOODNESS   OF GOD'", searchIndex(index, "goodness-of god").songs.length === 2 && searchIndex(index, "GOODNESS   OF GOD").songs.length === 2);
check("busca por 'Artista Canción' (palabras repartidas)", searchIndex(index, "hillsong oceans").songs.length === 1);
check("encuentra artistas Y canciones a la vez", (() => { const r = searchIndex(index, "bethel"); return r.artists.length === 2 && r.songs.length === 4; })());
check("empieza-por va primero", searchIndex(index, "cielos").songs[0]?.name.startsWith("Cielos"));
check("búsqueda vacía → sin resultados", searchIndex(index, "   ").songs.length === 0 && searchIndex(index, "").artists.length === 0);
check("sin coincidencias → vacío", searchIndex(index, "zzzz").songs.length === 0 && searchIndex(index, "zzzz").artists.length === 0);

// ---- Fallos ----
{
  const flaky = await buildIndex("ROOT", async () => artists, async (a) => { if (a.id === "a2") throw new Error("403"); return fetchSongs(a); });
  check("una carpeta que falla se omite y se cuenta", flaky.failed === 1 && flaky.songs.length === 10);
  let err: unknown = null;
  try { await buildIndex("ROOT", async () => artists, async () => { throw new Error("sin red"); }); } catch (e) { err = e; }
  check("si fallan todas, se informa el error", err instanceof Error && /sin red/.test(err.message));
  const controller = new AbortController();
  controller.abort();
  let aborted = false;
  try { await buildIndex("ROOT", async () => artists, fetchSongs, { signal: controller.signal }); } catch (e) { aborted = e instanceof DOMException; }
  check("se puede cancelar", aborted);
}

// ---- IndexedDB no disponible (Node): todo sigue funcionando en memoria ----
check("sin IndexedDB: guardar devuelve false y cargar devuelve null (sin romper)", (await saveIndex(index)) === false && (await loadIndex("ROOT")) === null);
check("fecha del índice legible", ageLabel(Date.now()) === "hoy" && ageLabel(Date.now() - 86_400_000) === "ayer" && ageLabel(Date.now() - 5 * 86_400_000) === "hace 5 días");

// ---- Etiquetas de tono y BPM ----
const tags: [string, string | undefined, number | undefined][] = [
  ["Algo Nuevo Empezó - D - 145bpm.zip", "D", 145],
  ["Algo Nuevo Empezó Ab 130,00 bpm.zip", "Ab", 130],
  ["Cerca De Mi Bb 105.zip", "Bb", 105],
  ["Cielos Abiertos - C#m - 72 BPM.zip", "C#m", 72],
  ["Goodness of God - Ab - 66bpm", "Ab", 66],
  ["Canción - Em.zip", "Em", undefined],
  ["Tu Fidelidad_G_80bpm.zip", "G", 80],
  ["Un Dia A La Vez.zip", undefined, undefined],
  ["Gracias 2020.zip", undefined, undefined],
  ["Reina 500 bpm raro.zip", undefined, undefined],
  ["Sin etiqueta.zip", undefined, undefined],
];
for (const [name, tone, bpm] of tags) {
  const got = parseSongTags(name);
  check(`etiquetas · ${name}`, got.tone === tone && got.bpm === bpm, `${got.tone ?? "—"} · ${got.bpm ?? "—"}`);
}

console.log(failed ? `\n${failed} comprobaciones FALLARON` : "\nTodas las comprobaciones pasaron");
process.exit(failed ? 1 : 0);
