// Verifica los nombres de entradas de un ZIP: UTF-8 (con y sin flag), CP850, CP437 y el respaldo windows-1252, por las dos rutas del lector
// (descompresor nativo y respaldo con fflate). Uso: node tools/verify-zipnames.ts
import { zipToFilesAsync } from "../src/archive.ts";
import { decodeCp850, decodeZipName } from "../src/zipNames.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

// ---- escritor mínimo de ZIP (método 0, nombres en bytes crudos) ----
const crc32 = (data: Uint8Array) => {
  let c, crc = 0xffffffff;
  for (const byte of data) { c = (crc ^ byte) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
};
function makeZip(entries: { name: Uint8Array; utf8Flag: boolean }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const content = new TextEncoder().encode("datos");
  for (const entry of entries) {
    const flags = entry.utf8Flag ? 0x800 : 0;
    const local = new Uint8Array(30 + entry.name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, flags, true);
    view.setUint32(14, crc32(content), true); view.setUint32(18, content.length, true); view.setUint32(22, content.length, true);
    view.setUint16(26, entry.name.length, true); local.set(entry.name, 30);
    const dir = new Uint8Array(46 + entry.name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(8, flags, true);
    dv.setUint32(16, crc32(content), true); dv.setUint32(20, content.length, true); dv.setUint32(24, content.length, true);
    dv.setUint16(28, entry.name.length, true); dv.setUint32(42, offset, true); dir.set(entry.name, 46);
    parts.push(local, content); central.push(dir); offset += local.length + content.length;
  }
  const dirSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, dirSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((sum, item) => sum + item.length, 0));
  let at = 0;
  for (const item of all) { out.set(item, at); at += item.length; }
  return out;
}

const NAMES = ["Acústica.wav", "Eléctrica.wav", "Guía.wav", "Batería.wav", "Piano.wav", "Bajo.wav", "Ñ.wav", "Órgano.wav"];
const reverse = new Map<string, number>();
for (let byte = 0x80; byte <= 0xff; byte++) reverse.set(decodeCp850(new Uint8Array([byte])), byte);
const encodeCp850 = (text: string) => Uint8Array.from([...text].map((ch) => (ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : (reverse.get(ch) as number))));
const encodeUtf8 = (text: string) => new TextEncoder().encode(text);

const cases: { label: string; entries: { name: Uint8Array; utf8Flag: boolean }[] }[] = [
  { label: "CP850 sin flag", entries: NAMES.map((n) => ({ name: encodeCp850(n), utf8Flag: false })) },
  { label: "CP437 sin flag (mismas letras del español)", entries: NAMES.filter((n) => !n.startsWith("Ó")).map((n) => ({ name: encodeCp850(n), utf8Flag: false })) },
  { label: "UTF-8 con flag", entries: NAMES.map((n) => ({ name: encodeUtf8(n), utf8Flag: true })) },
  { label: "UTF-8 sin flag", entries: NAMES.map((n) => ({ name: encodeUtf8(n), utf8Flag: false })) },
];

for (const useNative of [true, false]) {
  const saved = (globalThis as { DecompressionStream?: unknown }).DecompressionStream;
  if (!useNative) delete (globalThis as { DecompressionStream?: unknown }).DecompressionStream;
  try {
    for (const item of cases) {
      const expected = NAMES.filter((n) => item.entries.some((e) => decodeZipName(e.name, e.utf8Flag ? 0x800 : 0) === n));
      const files = await zipToFilesAsync(new Blob([makeZip(item.entries)]));
      const got = files.map((f) => f.name).sort();
      const want = item.entries.map((_, i) => (item.label.startsWith("CP437") ? NAMES.filter((n) => !n.startsWith("Ó"))[i] : NAMES[i])).sort();
      check(`${useNative ? "nativo " : "fflate "} ${item.label}`, JSON.stringify(got) === JSON.stringify(want) && expected.length === want.length, got.join(", "));
    }
  } finally {
    if (!useNative) (globalThis as { DecompressionStream?: unknown }).DecompressionStream = saved;
  }
}

// U+FFFD nunca debe aparecer; respaldo windows-1252 cuando CP850 daría signos de dibujo de cajas
check("CP850: 0x82 = é, 0xA1 = í, 0xA5 = Ñ", decodeCp850(new Uint8Array([0x82, 0xa1, 0xa5])) === "éíÑ");
check("sin U+FFFD en CP850", !decodeZipName(Uint8Array.from([0x47, 0x75, 0xa1, 0x61]), 0).includes("�"), decodeZipName(Uint8Array.from([0x47, 0x75, 0xa1, 0x61]), 0));
check("respaldo windows-1252 (0xB3 sería │ en CP850)", decodeZipName(Uint8Array.from([0x50, 0xb3]), 0) === "P³", decodeZipName(Uint8Array.from([0x50, 0xb3]), 0));
check("nombre ASCII intacto", decodeZipName(new TextEncoder().encode("Bajo.wav"), 0) === "Bajo.wav");

console.log(failed ? `\n${failed} comprobación(es) fallaron` : "\nTodo en orden");
process.exit(failed ? 1 : 0);
