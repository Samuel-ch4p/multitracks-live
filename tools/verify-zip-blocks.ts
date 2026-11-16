// P6: sin DecompressionStream (WebView viejo) el ZIP se lee por tramos, sin copiarlo entero a memoria.
// Uso: node tools/verify-zip-blocks.ts
import { zipSync, strToU8 } from "fflate";
import { zipToFilesAsync } from "../src/zipReader.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

/** Audio "falso" con algo de estructura (comprime, pero no a cero). */
function fakeAudio(size: number, seed: number) {
  const out = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i++) { x = (x * 1103515245 + 12345) >>> 0; out[i] = (i % 64 < 32 ? (x >>> 24) : (i * seed) & 255); }
  return out;
}
const tracks: Record<string, Uint8Array> = {
  "Cancion/Bajo.wav": fakeAudio(6_000_000, 1),
  "Cancion/Batería.wav": fakeAudio(5_000_000, 2),
  "Cancion/Click.mp3": fakeAudio(300_000, 3),
};
const zipBytes = zipSync({
  "Cancion/Bajo.wav": [tracks["Cancion/Bajo.wav"], { level: 6 }], // comprimida (DEFLATE)
  "Cancion/Batería.wav": [tracks["Cancion/Batería.wav"], { level: 0 }], // sin compresión (lo habitual en audio)
  "Cancion/Click.mp3": [tracks["Cancion/Click.mp3"], { level: 9 }],
  "Cancion/notas.txt": strToU8("no es audio"),
  "__MACOSX/Cancion/._Bajo.wav": strToU8("basura de mac"),
});

/** Blob que registra cada lectura: así se comprueba que nunca se pide el ZIP entero de una vez. */
class SpyBlob extends Blob {
  static maxSlice = 0;
  static wholeReads = 0;
  slice(start?: number, end?: number, type?: string): Blob {
    const s = start ?? 0;
    const e = end ?? this.size;
    SpyBlob.maxSlice = Math.max(SpyBlob.maxSlice, e - s);
    return super.slice(start, end, type);
  }
  async arrayBuffer(): Promise<ArrayBuffer> { SpyBlob.wholeReads++; return super.arrayBuffer() as Promise<ArrayBuffer>; }
}

const equal = async (file: File, expected: Uint8Array) => { const b = new Uint8Array(await file.arrayBuffer()); return b.length === expected.length && b.every((v, i) => v === expected[i]); };

for (const native of [false, true]) {
  const label = native ? "con descompresor nativo" : "SIN descompresor nativo (WebView viejo)";
  SpyBlob.maxSlice = 0;
  SpyBlob.wholeReads = 0;
  const blob = new SpyBlob([zipBytes as BlobPart], { type: "application/zip" });
  const progress: number[] = [];
  const files = await zipToFilesAsync(blob, (done) => progress.push(done), { nativeInflate: native });
  const names = files.map((f) => f.name).sort();
  check(`${label}: solo las 3 pistas de audio (sin .txt ni __MACOSX)`, names.join("|") === ["Bajo.wav", "Batería.wav", "Click.mp3"].sort().join("|"), names.join(", "));
  let allEqual = true;
  for (const file of files) {
    const key = Object.keys(tracks).find((k) => k.endsWith("/" + file.name));
    if (!key || !(await equal(file, tracks[key]))) allEqual = false;
  }
  check(`${label}: contenido idéntico (comprimidas y sin comprimir)`, allEqual);
  check(`${label}: nunca se copia el ZIP entero a memoria`, SpyBlob.wholeReads === 0 && SpyBlob.maxSlice < blob.size, `mayor lectura ${SpyBlob.maxSlice} de ${blob.size} bytes`);
  check(`${label}: progreso pista a pista`, progress.length === 3 && progress[2] === 3);
}

{
  // ZIP dañado: mensaje claro, no un cierre
  let message = "";
  try { await zipToFilesAsync(new Blob([zipBytes.subarray(0, 1000) as BlobPart]), undefined, { nativeInflate: false }); } catch (e) { message = e instanceof Error ? e.message : ""; }
  check("ZIP incompleto: mensaje claro", /dañado o incompleto/.test(message), message);
}

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
