// Verifica los perfiles de pistas: claves, prioridad canción > predeterminado > fábrica, validación, almacenamiento y exportar/importar.
// Uso: node tools/verify-profiles.ts
import {
  FACTORY_MASTER, buildGeneral, buildSong, clearGeneral, clearSongProfile, exportGeneral, importGeneral, loadGeneral, loadSongProfile,
  resolveProfile, sanitizeGeneral, saveGeneralProfile, saveSongProfile, songKeyOf, trackKey, type LiveTrack,
} from "../src/trackProfiles.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

// ---- Claves de tipo de pista ----
check("clave: 'Keys 1' y 'keys 2' son el mismo tipo", trackKey("Keys 1") === "keys" && trackKey("keys 2") === "keys" && trackKey("KEYS") === "keys");
check("clave: sin acentos ni mayúsculas ('Batería' = 'bateria')", trackKey("Batería") === trackKey("BATERIA") && trackKey("Batería") === "bateria");
check("clave: 'Lead Vox' ≠ 'BGVS'; 'EG 3' → 'eg'", trackKey("Lead Vox") === "lead vox" && trackKey("BGVS") === "bgvs" && trackKey("EG 3") === "eg");
check("clave: nombres solo numéricos no quedan vacíos", trackKey("808") === "808" && trackKey("") === "");

// ---- Perfil de ejemplo ----
const files = ["Bajo", "Batería", "Keys 1", "Click Track", "Guide", "Coros"];
const input = files.map((n) => ({ fileName: `Song - ${n}.flac`, displayName: n }));
const live = (over: Record<string, Partial<LiveTrack>> = {}): LiveTrack[] =>
  input.map((t) => ({ ...t, volume: 80, pan: /Click|Guide/.test(t.displayName) ? -1 : 0, muted: false, solo: false, ...over[t.displayName] }));

// ---- Fábrica ----
const factory = resolveProfile(input, null, null);
check("fábrica: todo en 80 y centro; Click y Guía a la izquierda (-1)", input.every((t) => {
  const s = factory.settings.get(t.fileName)!;
  const left = /Click|Guide/.test(t.displayName);
  return s.volume === 80 && s.pan === (left ? -1 : 0) && !s.muted && !s.solo;
}));
check("fábrica: master 85 y etiqueta 'factory'", factory.master === FACTORY_MASTER && factory.source === "factory");

// ---- Perfil general ----
const general = buildGeneral(null, live({ Bajo: { volume: 60, pan: 0.2 }, Batería: { volume: 90 }, "Keys 1": { volume: 50, muted: true }, Coros: { pan: -0.3, solo: true } }), 70);
const g1 = resolveProfile(input, null, general);
check("general: se aplica a las pistas cuyo nombre coincide", g1.settings.get("Song - Bajo.flac")!.volume === 60 && g1.settings.get("Song - Bajo.flac")!.pan === 0.2 && g1.settings.get("Song - Keys 1.flac")!.muted && g1.settings.get("Song - Coros.flac")!.solo);
check("general: etiqueta 'Predeterminado' y master del perfil", g1.source === "general" && g1.master === 70);
const other = [{ fileName: "Otra - Keys 4.wav", displayName: "Keys 4" }, { fileName: "Otra - Percusión.wav", displayName: "Percusión" }, { fileName: "Otra - Click.wav", displayName: "Click" }];
const g2 = resolveProfile(other, null, general);
check("general: 'Keys 4' usa el perfil de 'Keys' (mismo tipo)", g2.settings.get("Otra - Keys 4.wav")!.volume === 50 && g2.sources.get("Otra - Keys 4.wav") === "general");
check("general: pista sin coincidencia ('Percusión') usa fábrica", g2.settings.get("Otra - Percusión.wav")!.volume === 80 && g2.sources.get("Otra - Percusión.wav") === "factory");
check("general: Click sin perfil guardado sigue a la izquierda (fábrica)", g2.settings.get("Otra - Click.wav")!.pan === -1);
const only = resolveProfile([{ fileName: "x.wav", displayName: "Cuerdas" }], null, general);
check("general sin ninguna coincidencia: etiqueta 'Predeterminado' solo si trae master (aquí sí) ", only.source === "general");
check("general sin coincidencia y sin master: 'Fábrica'", resolveProfile([{ fileName: "x.wav", displayName: "Cuerdas" }], null, { ...general, master: null }).source === "factory");

// ---- Prioridad: canción > predeterminado > fábrica ----
const song = buildSong(live({ Bajo: { volume: 30, pan: -0.5 } }), 55);
const s1 = resolveProfile(input, song, general);
check("prioridad: la canción manda sobre el predeterminado", s1.settings.get("Song - Bajo.flac")!.volume === 30 && s1.settings.get("Song - Bajo.flac")!.pan === -0.5 && s1.sources.get("Song - Bajo.flac") === "song");
check("prioridad: el master de la canción manda", s1.master === 55 && s1.masterSource === "song" && s1.source === "song");
const partialSong = { version: 1 as const, master: null, tracks: { "Song - Bajo.flac": { volume: 10, pan: 0, muted: false, solo: false } } };
const s2 = resolveProfile(input, partialSong, general);
check("prioridad: pista que la canción no define → cae al predeterminado; master → predeterminado", s2.sources.get("Song - Batería.flac") === "general" && s2.settings.get("Song - Batería.flac")!.volume === 90 && s2.master === 70 && s2.masterSource === "general");
check("prioridad: canción > general > fábrica en una misma carga", (() => {
  const mixed = resolveProfile([...input, { fileName: "Song - Extra.flac", displayName: "Extra" }], partialSong, general);
  return mixed.sources.get("Song - Bajo.flac") === "song" && mixed.sources.get("Song - Coros.flac") === "general" && mixed.sources.get("Song - Extra.flac") === "factory";
})());

// ---- Guardar: el general se fusiona; las pistas repetidas toman la primera ----
const merged = buildGeneral(general, [{ fileName: "z.wav", displayName: "Cuerdas", volume: 40, pan: 0, muted: false, solo: false }], 65);
check("guardar predeterminado: conserva los tipos que no están en esta canción y añade los nuevos", merged.tracks["bajo"] !== undefined && merged.tracks["cuerdas"].volume === 40 && merged.master === 65);
const dup = buildGeneral(null, [
  { fileName: "a.wav", displayName: "Keys 1", volume: 11, pan: 0, muted: false, solo: false },
  { fileName: "b.wav", displayName: "Keys 2", volume: 99, pan: 0, muted: false, solo: false },
], 80);
check("pistas del mismo tipo (Keys 1 / Keys 2): se guarda la primera", dup.tracks["keys"].volume === 11 && Object.keys(dup.tracks).length === 1);
check("el perfil guarda la familia de cada tipo", general.tracks["click track"].family === "guide" && general.tracks["bajo"].family === "harmony");
check("el perfil NO incluye ganancia de normalización (solo volumen, paneo, mute, solo)", Object.values(general.tracks).every((e) => Object.keys(e).sort().join() === "family,muted,pan,solo,volume"));

// ---- Validación ----
check("validación: valores fuera de rango se limitan", (() => {
  const p = sanitizeGeneral({ master: 500, tracks: { keys: { volume: 900, pan: -7, muted: "sí", solo: 1 } } })!;
  return p.master === 100 && p.tracks["keys"].volume === 100 && p.tracks["keys"].pan === -1 && p.tracks["keys"].muted === false && p.tracks["keys"].solo === false;
})());
check("validación: basura → null o vacío, sin romper", sanitizeGeneral("hola") === null && sanitizeGeneral({ tracks: { a: 5, b: null, c: { volume: "x" } } })!.master === null && Object.keys(sanitizeGeneral({ tracks: { a: 5, b: null } })!.tracks).length === 0);

// ---- Almacenamiento (localStorage simulado) ----
{
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
  };
  const key = songKeyOf(input.map((t) => ({ name: t.fileName, size: 1000 })));
  check("claves de canción: no dependen del orden, sí del tamaño", key === songKeyOf([...input].reverse().map((t) => ({ name: t.fileName, size: 1000 }))) && key !== songKeyOf(input.map((t) => ({ name: t.fileName, size: 1001 }))));
  check("guardar y cargar el predeterminado", saveGeneralProfile(general) && JSON.stringify(loadGeneral()) === JSON.stringify(general));
  check("guardar y cargar el de la canción (clave nombre+tamaño)", saveSongProfile(key, song) && loadSongProfile(key)?.tracks["Song - Bajo.flac"].volume === 30 && loadSongProfile("otra") === null);
  clearSongProfile(key);
  check("restablecer: borra el de la canción y el predeterminado", loadSongProfile(key) === null && (clearGeneral(), loadGeneral()) === null);
  store.set("crescendo-profile-general-v1", "{no es json");
  check("almacenamiento con datos corruptos → null, sin romper", loadGeneral() === null);
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("cuota"); }, removeItem: () => { throw new Error("bloqueado"); },
  };
  check("sin localStorage (lanza errores): todo devuelve null/false y no se rompe", loadGeneral() === null && saveGeneralProfile(general) === false && loadSongProfile("x") === null && (clearGeneral(), true));
}

// ---- Exportar / importar ----
{
  const text = exportGeneral(general);
  const back = importGeneral(text);
  check("exportar → importar devuelve el mismo perfil", !!back && JSON.stringify(back) === JSON.stringify(general), `${text.length} bytes`);
  check("importar rechaza archivos que no son del app o están vacíos", importGeneral("{}") === null && importGeneral("no json") === null && importGeneral(JSON.stringify({ app: "crescendo-live", profile: { tracks: {} } })) === null && importGeneral(JSON.stringify({ app: "otra", profile: general })) === null);
}

console.log(failed ? `\n${failed} comprobaciones FALLARON` : "\nTodas las comprobaciones pasaron");
process.exit(failed ? 1 : 0);
