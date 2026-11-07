// Verifica los cultos guardados y la sesión autoguardada sin dispositivo: separación por user_id, migración de la lista anterior,
// configuración del mezclador (mezcla, marcadores, click, pad), validación de datos y que NO se guarda audio.
// Uso: node tools/verify-setlists.ts
import { setCloudStorage } from "../src/cloud/storage.ts";
import { defaultSetlistName, loadSession, loadSetlists, persistSetlists, saveSession, type SavedSetlist } from "../src/setlistStore.ts";

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

const culto: SavedSetlist = {
  id: "c1", name: "Culto 9 nov", createdAt: 1, updatedAt: 2, master: 77,
  songs: [{
    id: "s1", key: "Artista/Canción.zip", title: "Canción", tone: "G", bpm: 72,
    config: {
      tracks: [{ fileName: "Bateria.wav", volume: 64, pan: -0.3, muted: false, solo: true }, { fileName: "Click.wav", volume: 90, pan: -1, muted: true, solo: false }],
      markers: [{ id: 1, name: "Coro", position: 0.42, color: "var(--fam-vocal)" }],
      click: { bpm: 72, beats: 4, subdivision: 2, accent: true, sound: "wood", output: "left", volume: 55 },
      pad: { note: "G", sharp: false, minor: false, volume: 40 },
    },
  }],
};

// Separación por user_id
await persistSetlists("ana", [culto]);
check("el culto de Ana vuelve igual (mezcla, marcadores, click y pad)", JSON.stringify((await loadSetlists("ana"))[0]) === JSON.stringify(culto));
check("otra cuenta en el mismo teléfono no ve los cultos de Ana", (await loadSetlists("beto")).length === 0);

// Sesión autoguardada, también por usuario; con null se borra
await saveSession("ana", { name: "Culto 9 nov", updatedAt: 5, master: 70, songs: culto.songs });
const session = await loadSession("ana");
check("la sesión de Ana se recupera con su nombre y canciones", session?.name === "Culto 9 nov" && session.songs.length === 1 && session.master === 70);
check("otra cuenta no ve la sesión de Ana", (await loadSession("beto")) === null);
await saveSession("ana", null);
check("saveSession(null) borra la sesión", (await loadSession("ana")) === null);
check("borrar la sesión no toca los cultos guardados", (await loadSetlists("ana")).length === 1);

// Migración de la lista anterior (sin dueño): pasa al primer usuario y deja de existir
mem.set("crescendo.setlists.v1", JSON.stringify([{ id: "v1", name: "Viejo", createdAt: 1, updatedAt: 1, songs: [{ id: "a", key: "k", title: "t" }] }]));
const migrated = await loadSetlists("carla");
check("la lista anterior pasa al primer usuario", migrated.length === 1 && migrated[0].name === "Viejo");
check("la clave anterior se elimina", !mem.has("crescendo.setlists.v1"));
check("el siguiente usuario no hereda la lista anterior", (await loadSetlists("diego")).length === 0);

// Cultos guardados con la versión de perfiles: el campo "profile" se ignora sin romper la carga
mem.set("crescendo.cultos.v2:fabi", JSON.stringify([{ id: "p", name: "Con perfil", songs: [{ id: "1", key: "k", title: "t", config: { tracks: [{ fileName: "a.wav", volume: 70, pan: 0, muted: false, solo: false }], profile: "general" } }] }]));
const legacy = await loadSetlists("fabi");
check("un culto con campo profile se carga y lo conserva la mezcla", legacy[0]?.songs[0]?.config?.tracks[0]?.volume === 70 && !("profile" in (legacy[0].songs[0].config ?? {})));

// Datos dañados o fuera de rango
mem.set("crescendo.cultos.v2:eva", JSON.stringify([
  { id: "x", name: "Raro", songs: [{ id: "1", key: "k", title: "t", config: { tracks: [{ fileName: "a.wav", volume: 900, pan: 7, muted: "sí", solo: 1 }, { fileName: 3 }], markers: [{ name: "Z", position: 9, color: "red" }, "basura"] } }, { id: 5 }] },
  "basura",
]));
const dirty = await loadSetlists("eva");
const track = dirty[0]?.songs[0]?.config?.tracks[0];
check("valores fuera de rango se limitan y lo inválido se descarta", dirty.length === 1 && dirty[0].songs.length === 1 && dirty[0].songs[0].config?.tracks.length === 1 && track?.volume === 100 && track.pan === 1 && track.muted === false && track.solo === false);
check("marcadores inválidos se descartan y la posición se limita", dirty[0].songs[0].config?.markers?.length === 1 && dirty[0].songs[0].config.markers[0].position === 1);
mem.set("crescendo.sesion.v1:eva", "{no es json");
check("una sesión ilegible se ignora sin fallar", (await loadSession("eva")) === null);

// Solo referencias y configuración: nunca audio
const stored = [...mem.values()].join("");
check("lo guardado no contiene datos de audio", !/data:audio|blob:|ArrayBuffer|base64/i.test(stored));

check("nombre sugerido «Culto <fecha>»", /^Culto \d{1,2} [a-zñ]{3,4}$/i.test(defaultSetlistName(new Date(2026, 10, 9))), defaultSetlistName(new Date(2026, 10, 9)));

console.log(failed ? `\n${failed} comprobación(es) con FALLA` : "\nTodo en orden");
process.exit(failed ? 1 : 0);
