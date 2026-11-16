// Nivel 3: sesiones y cultos guardan también las canciones de «Este dispositivo» (referencia + mezcla, nunca audio) y se restauran
// al elegir el archivo coincidente. Compatibilidad con lo guardado antes. Uso: node tools/verify-local-songs.ts
import { setCloudStorage } from "../src/cloud/storage.ts";
import { localRefOf, matchLocalPlaceholder, sanitizeLocalRef } from "../src/localSongs.ts";
import { loadSession, loadSetlists, persistSetlists, saveSession, type SavedSetlist } from "../src/setlistStore.ts";
import { songKeyOf } from "../src/trackProfiles.ts";

const mem = new Map<string, string>();
setCloudStorage({
  async get(key) { return mem.get(key) ?? null; },
  async set(key, value) { mem.set(key, value); },
  async remove(key) { mem.delete(key); },
});

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

const files = [{ name: "Bajo.wav", size: 1000 }, { name: "Voz.wav", size: 2000 }, { name: "Click.wav", size: 300 }];
const ref = localRefOf(files);
check("la referencia local no lleva audio: solo nombres y tamaños", JSON.stringify(ref).length < 300 && ref.files.every((f) => Object.keys(f).sort().join() === "name,size"));
check("referencia dañada → null", sanitizeLocalRef({ songKey: "x" }) === null && sanitizeLocalRef("basura") === null);

// Emparejar al volver a elegir el archivo
const placeholders = [
  { id: 1, name: "Cerca", local: localRefOf([{ name: "A.wav", size: 1 }]) },
  { id: 2, name: "Jubilo", local: ref },
];
check("mismo archivo (mismos nombres y tamaños) → su canción", matchLocalPlaceholder(placeholders, "Otro nombre", files) === 2);
check("mismo título y mismas pistas pero otros tamaños (re-exportado) → su canción", matchLocalPlaceholder(placeholders, "jubilo", files.map((f) => ({ ...f, size: f.size + 7 }))) === 2);
check("otra canción → ninguna", matchLocalPlaceholder(placeholders, "Nueva", [{ name: "X.wav", size: 5 }]) === null);
check("mismo título pero otras pistas → ninguna (no se mezcla la mezcla)", matchLocalPlaceholder(placeholders, "Jubilo", [{ name: "Bajo.wav", size: 1 }]) === null);

// Guardar y leer un culto con nube + local, con la mezcla de cada canal
const mix = [
  { fileName: "Bajo.wav", volume: 64, pan: -0.3, muted: false, solo: false },
  { fileName: "Voz.wav", volume: 90, pan: 0, muted: true, solo: false },
  { fileName: "Click.wav", volume: 70, pan: -1, muted: false, solo: true },
];
const culto: SavedSetlist = {
  id: "c1", name: "Domingo", createdAt: 1, updatedAt: 1, master: 85,
  songs: [
    { id: "nube-1", key: "library/a.zip", title: "De la nube", config: { tracks: [] } },
    { id: `local:${ref.songKey}`, key: "", title: "Jubilo", local: ref, config: { tracks: mix } },
  ],
};
await persistSetlists("u1", [culto]);
const [back] = await loadSetlists("u1");
const local = back.songs[1];
check("el culto guarda la canción local", !!local?.local && local.local.songKey === songKeyOf(files));
check("…con volumen, paneo, mute y solo de cada canal", JSON.stringify(local.config?.tracks) === JSON.stringify(mix));
check("la de la nube sigue igual (sin `local`)", back.songs[0].key === "library/a.zip" && !back.songs[0].local);

await saveSession("u1", { name: "Sesión", updatedAt: 2, songs: culto.songs });
const session = await loadSession("u1");
check("la sesión autoguardada también conserva la local", session?.songs.some((s) => s.local?.songKey === ref.songKey) === true);

// Compatibilidad hacia atrás: guardado de la 1.0 (solo nube, sin `local`)
mem.set("crescendo.cultos.v2:u2", JSON.stringify([{ id: "v1", name: "Viejo", createdAt: 1, updatedAt: 1, songs: [{ id: "n", key: "library/b.zip", title: "Vieja", config: { tracks: mix } }] }]));
const [old] = await loadSetlists("u2");
check("culto guardado con la 1.0 se lee igual", old?.songs.length === 1 && old.songs[0].key === "library/b.zip" && !old.songs[0].local);

// Una referencia local dañada no rompe el culto: solo se omite esa canción
mem.set("crescendo.cultos.v2:u3", JSON.stringify([{ id: "x", name: "Dañado", createdAt: 1, updatedAt: 1, songs: [{ id: "local:?", key: "", title: "Rota", local: { songKey: 5 } }, { id: "n", key: "library/c.zip", title: "Bien" }] }]));
const [damaged] = await loadSetlists("u3");
check("referencia local dañada: se omite esa canción, el resto se carga", damaged?.songs.length === 1 && damaged.songs[0].title === "Bien");

check("nada de audio en lo guardado", ![...mem.values()].some((v) => /RIFF|data:audio|blob:/.test(v)));

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
