// Port a Node de tools/make_pad_loops.py: ciclo de 32 s sin corte, RMS -19 dB, OGG.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const [ffmpeg, srcDir, outDir, tmpDir] = process.argv.slice(2);
const SR = 44100, LOOP = 32, XF = 6, TARGET = Math.pow(10, -19 / 20);
const JOBS = {
  "Cs": ["C#.mp3", 600], "Ds": ["D#.mp3", 600], "Fs": ["F#.mp3", 600], "Gs": ["G#.mp3", 600], "As": ["A#.mp3", 600],
  "Cm": ["Cm.mp3", 300], "Dm": ["Dm.mp3", 300], "Em": ["Em.mp3", 300], "Fm": ["Fm.mp3", 300],
  "Gm": ["Gm.mp3", 300], "Am": ["Am.mp3", 300], "Bm": ["Bm.mp3", 300],
};
fs.mkdirSync(outDir, { recursive: true });
for (const [key, [file, start]] of Object.entries(JOBS)) {
  const r = spawnSync(ffmpeg, ["-v", "error", "-ss", String(start), "-t", String(LOOP + XF), "-i", `${srcDir}/${file}`, "-f", "f32le", "-ac", "2", "-ar", String(SR), "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`${key}: ${r.stderr}`);
  const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
  const n = LOOP * SR, f = XF * SR;
  if (x.length / 2 < n + f) throw new Error(`${key}: audio demasiado corto`);
  const loop = new Float64Array(n * 2);
  for (let i = 0; i < n * 2; i++) loop[i] = x[i];
  for (let i = 0; i < f; i++) {
    const t = i / (f - 1), a = Math.sin(t * Math.PI / 2), b = Math.cos(t * Math.PI / 2);
    for (let c = 0; c < 2; c++) loop[i * 2 + c] = loop[i * 2 + c] * a + x[(n + i) * 2 + c] * b;
  }
  let sum = 0; for (const v of loop) sum += v * v;
  const g = TARGET / Math.sqrt(sum / loop.length);
  let peak = 0; for (let i = 0; i < loop.length; i++) { loop[i] *= g; peak = Math.max(peak, Math.abs(loop[i])); }
  if (peak > 0.9) for (let i = 0; i < loop.length; i++) loop[i] *= 0.9 / peak;
  const pcm = Buffer.alloc(loop.length * 2);
  for (let i = 0; i < loop.length; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, loop[i])) * 32767), i * 2);
  const hdr = Buffer.alloc(44);
  hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVEfmt ", 8); hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28);
  hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);
  const wav = `${tmpDir}/${key}.wav`;
  fs.writeFileSync(wav, Buffer.concat([hdr, pcm]));
  const e = spawnSync(ffmpeg, ["-v", "error", "-y", "-i", wav, "-c:a", "libvorbis", "-q:a", "4", `${outDir}/${key}.ogg`]);
  if (e.status !== 0) throw new Error(`${key}: ${e.stderr}`);
  let seam = 0, jump = 0;
  for (let c = 0; c < 2; c++) seam = Math.max(seam, Math.abs(loop[c] - loop[loop.length - 2 + c]));
  for (let i = 2; i < loop.length; i++) jump = Math.max(jump, Math.abs(loop[i] - loop[i - 2]));
  console.log(key, "pico", peak.toFixed(2), "empalme", seam.toFixed(4), "salto máx", jump.toFixed(4), "ogg", fs.statSync(`${outDir}/${key}.ogg`).size >> 10, "KB");
}
