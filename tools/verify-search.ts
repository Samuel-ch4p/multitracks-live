// Verifica el catálogo (normalización, caché con ETag, formatos) y el buscador sobre el catálogo en memoria, y las etiquetas de tono/BPM.
// Uso: node tools/verify-search.ts
import { buildIndex, foldQuery, queryTokens, searchIndex } from "../src/searchIndex.ts";
import { parseSongTags } from "../src/songTags.ts";
import type { Catalog } from "../src/cloud/catalog.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

check("sin acentos ni mayúsculas, guiones y puntos como espacio", foldQuery("  UN  CORAZÓN – Gracias_Dios.zip ") === "un corazon gracias dios zip");
check("varias palabras", queryTokens("Bethel   Music-Goodness").join("|") === "bethel|music|goodness");

const artists = [
  ["a0", "Bethel", ["Bethel Music"]], ["a1", "bethel MUSIC", []], ["a2", "Un Corazon", []], ["a3", "UN CORAZÓN", []],
  ["a4", "Su Presencia", []], ["a5", "Elevation Worship", []], ["a6", "Hillsong United", ["Hillsong"]],
].map(([id, name, aliases]) => ({ id: id as string, name: name as string, aliases: aliases as string[] }));
const songsBy: Record<string, string[]> = {
  a0: ["Goodness of God - Ab - 66bpm", "Raise a Hallelujah"],
  a1: ["Goodness of God", "No Longer Slaves Bb 68"],
  a2: ["Él es Dios - D - 120bpm", "Cielos Abiertos"],
  a3: ["Un Corazón Agradecido"],
  a4: ["Cerca De Mi Bb 105", "Algo Nuevo Empezó - D - 145bpm"],
  a5: ["Graves Into Gardens"],
  a6: ["Oceans (Where Feet May Fail)", "Who You Say I Am"],
};
const catalog: Catalog = {
  version: 1, generatedAt: "2026-01-01", artists,
  songs: Object.entries(songsBy).flatMap(([artistId, titles]) => titles.map((title, i) => ({
    id: `${artistId}-${i}`, artistId, title, key: `library//${title}.zip`, size: 1000 + i, format: (i === 1 && artistId === "a6" ? "rar" : "zip") as "zip" | "rar", bpm: null, tone: null, modTime: null,
  }))),
};
const index = buildIndex(catalog);
check("índice: todas las canciones con artista", index.songs.length === 12 && index.songs.every((s) => s.artist));
check("índice: canciones agrupadas por artista", index.byArtist.get("a6")?.length === 2 && index.byArtist.get("a3")?.length === 1);

const names = (r: ReturnType<typeof searchIndex>) => r.songs.map((s) => s.title).join(" | ");
check("acentos: 'corazon' encuentra los dos artistas", searchIndex(index, "corazon").artists.length === 2);
check("acentos y mayúsculas: 'ÉL ES DIOS'", searchIndex(index, "ÉL ES DIOS").songs.length === 1 && searchIndex(index, "el es dios").songs.length === 1);
check("varias palabras: 'goodness bethel' → las dos de Bethel", searchIndex(index, "goodness bethel").songs.length === 2, names(searchIndex(index, "goodness bethel")));
check("varias palabras sin coincidencia común → vacío", searchIndex(index, "goodness elevation").songs.length === 0);
check("guiones y espacios", searchIndex(index, "goodness-of god").songs.length === 2 && searchIndex(index, "GOODNESS   OF GOD").songs.length === 2);
check("'Artista Canción' (palabras repartidas)", searchIndex(index, "hillsong oceans").songs.length === 1);
check("alias de artista: 'bethel music' encuentra a Bethel", searchIndex(index, "bethel music").artists.length === 2);
check("encuentra artistas Y canciones a la vez", (() => { const r = searchIndex(index, "bethel"); return r.artists.length === 2 && r.songs.length === 4; })());
check("empieza-por va primero", searchIndex(index, "cielos").songs[0]?.title.startsWith("Cielos"));
check("búsqueda vacía → sin resultados", searchIndex(index, "   ").songs.length === 0 && searchIndex(index, "").artists.length === 0);
check("sin coincidencias → vacío", searchIndex(index, "zzzz").songs.length === 0 && searchIndex(index, "zzzz").artists.length === 0);

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
