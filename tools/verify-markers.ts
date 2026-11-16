// I2: el autoguardado no borra marcadores de canciones que no están en memoria, y restaurar no pisa los marcadores locales.
// Uso: node tools/verify-markers.ts
import { markersToApply, snapshotMarkers, type Marker } from "../src/markers.ts";
import { songKeyOf } from "../src/trackProfiles.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

// "localStorage" simulado por clave de canción
const store = new Map<string, Marker[]>();
const load = (key: string) => store.get(key) ?? [];
const save = (key: string, markers: Marker[]) => { if (markers.length) store.set(key, markers); else store.delete(key); };

const coro: Marker = { id: 1, name: "Coro", position: 0.4, color: "var(--fam-vocal)" };
const puente: Marker = { id: 2, name: "Puente", position: 0.7, color: "var(--c-warn)" };
const files = [{ name: "Bajo.wav", size: 1000 }, { name: "Click.wav", size: 900 }];
const key = songKeyOf(files);
save(key, [coro, puente]);

// La clave de "cero archivos" es la misma para TODAS las canciones no cargadas: era el origen del bug
check("(contexto) la clave de cero archivos es compartida", songKeyOf([]) === songKeyOf([]));

// 1) Cargada: lee los marcadores reales
check("canción cargada: marcadores del teléfono", snapshotMarkers({ files }, load, songKeyOf)?.length === 2);

// 2) Soltada de la memoria (files vacío pero con su clave): sigue guardando sus marcadores
const released = snapshotMarkers({ files: [], songKey: key }, load, songKeyOf);
check("canción soltada de la memoria: conserva sus 2 marcadores (antes: [])", released?.length === 2);

// 3) Nunca cargada, viene de un culto con marcadores: se guardan los del culto tal cual
const fromCulto = snapshotMarkers({ files: [], config: { markers: [coro] } }, load, songKeyOf);
check("nunca cargada con marcadores del culto: se conservan", fromCulto?.length === 1 && fromCulto[0].name === "Coro");

// 4) Nunca cargada y sin marcadores guardados: undefined (no "lista vacía")
check("nunca cargada sin marcadores: undefined (no se toca nada al restaurar)", snapshotMarkers({ files: [] }, load, songKeyOf) === undefined);

// 5) Restaurar: [] o undefined NUNCA borran los locales
check("restaurar con [] no borra los marcadores locales", markersToApply([]) === null);
check("restaurar con undefined no toca nada", markersToApply(undefined) === null);
check("restaurar con marcadores del culto: se aplican", markersToApply([puente])?.[0].name === "Puente");

// 6) Ciclo completo del bug: autoguardado con la canción fuera de memoria → reabrir → cargar → los marcadores siguen ahí
{
  const saved = snapshotMarkers({ files: [], songKey: key }, load, songKeyOf); // autoguardado
  const restore = markersToApply(saved); // al reabrir y cargar la canción
  if (restore) save(key, restore);
  check("ciclo autoguardado → reabrir → cargar: los marcadores sobreviven", load(key).length === 2);
}
{
  // Sesión antigua ya dañada (guardada con [] por la versión anterior): no borra lo que hay en el teléfono
  const restore = markersToApply([]);
  if (restore) save(key, restore);
  check("sesión antigua guardada con []: los marcadores locales sobreviven", load(key).length === 2);
}

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
