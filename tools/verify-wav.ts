// Verifica el análisis directo de WAV (src/wavAnalysis.ts) contra la medición sobre muestras decodificadas.
// Uso: node tools/verify-wav.ts
import { measureBuffer } from "../src/analysis.ts";
import { analyzeWav } from "../src/wavAnalysis.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

const SR = 22050;
const N = SR * 12;
const left = Float32Array.from({ length: N }, (_, i) => 0.4 * Math.sin(i * 0.03) * (0.3 + 0.7 * Math.abs(Math.sin(i / 30000))));
const right = Float32Array.from(left, (v, i) => v * 0.5 + 0.1 * Math.sin(i * 0.07));
const silent = new Float32Array(N);

function wav(channels: Float32Array[], bits: 16 | 24, extensible = false): Blob {
  const c = channels.length, bytes = bits / 8, header = extensible ? 68 : 44;
  const buffer = new ArrayBuffer(header + N * c * bytes);
  const view = new DataView(buffer);
  const tag = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  tag(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); tag(8, "WAVE");
  tag(12, "fmt "); view.setUint32(16, extensible ? 40 : 16, true);
  view.setUint16(20, extensible ? 0xfffe : 1, true); view.setUint16(22, c, true); view.setUint32(24, SR, true);
  view.setUint32(28, SR * c * bytes, true); view.setUint16(32, c * bytes, true); view.setUint16(34, bits, true);
  if (extensible) { view.setUint16(36, 22, true); view.setUint16(38, bits, true); view.setUint32(40, 3, true); view.setUint16(44, 1, true); }
  tag(header - 8, "data"); view.setUint32(header - 4, N * c * bytes, true);
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < c; k++) {
      const at = header + (i * c + k) * bytes;
      if (bits === 16) view.setInt16(at, Math.round(channels[k][i] * 32767), true);
      else {
        const q = Math.round(channels[k][i] * 8388607);
        view.setUint8(at, q & 255); view.setUint8(at + 1, (q >> 8) & 255); view.setUint8(at + 2, (q >> 16) & 255);
      }
    }
  }
  return new Blob([buffer]);
}

const reference = async (chs: Float32Array[]) =>
  (await measureBuffer({ numberOfChannels: chs.length, length: N, sampleRate: SR, getChannelData: (i) => chs[i] }))!;

for (const [name, chs, bits, ext] of [
  ["16 bits estéreo", [left, right], 16, false],
  ["24 bits mono", [left], 24, false],
  ["16 bits solo lado izquierdo", [left, silent], 16, false],
  ["16 bits estéreo (cabecera extensible)", [left, right], 16, true],
] as const) {
  const got = await analyzeWav(wav([...chs], bits, ext), 1500, () => false);
  const ref = await reference([...chs]);
  const ok = got && got !== "cancelled" && got.stats.layout === ref.layout &&
    Math.abs(got.stats.peak - ref.peak) < 2e-3 && Math.abs(got.stats.power / ref.power - 1) < 0.01;
  check(`WAV directo = decodificado · ${name}`, !!ok, got && got !== "cancelled" ? `${got.stats.layout} pico ${got.stats.peak.toFixed(3)} potencia ${got.stats.power.toFixed(5)} (ref ${ref.power.toFixed(5)})` : String(got));
  if (got && got !== "cancelled") check(`   forma de onda: ${got.peaks.length} tramos, sin vacíos`, got.peaks.every((p) => p > 0));
}
check("archivo que no es WAV → null (se usa el camino normal)", (await analyzeWav(new Blob([new Uint8Array(100)]), 1500, () => false)) === null);
check("cancelar se respeta", (await analyzeWav(wav([left], 16), 1500, () => true)) === "cancelled");

console.log(failed ? `\n${failed} comprobaciones FALLARON` : "\nTodas las comprobaciones pasaron");
process.exit(failed ? 1 : 0);
