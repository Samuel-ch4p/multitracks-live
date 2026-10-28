// Verificación de la normalización y del reparto de paneo (sin navegador).
// Uso:  node tools/verify-normalize.ts      (Node 22.6+ con --experimental-strip-types, o Node 24)
import { measureBuffer, toDb, type TrackStats } from "../src/analysis.ts";
import { gatedMeanPower, limiterCurve, mixLevelDb, planNormalization, type PlanTrack } from "../src/normalizer.ts";
import { LIMITER_KNEE_DB, MAX_GAIN_DB, MIN_GAIN_DB, PEAK_CEILING_DB, REFERENCE_DB } from "../src/normConfig.ts";
import { panTaps, type Layout } from "../src/panLaw.ts";
import { isGuideOrClick } from "../src/trackFamilies.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

const SR = 22050;
let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const noise = (seconds: number, amp: number) => Float32Array.from({ length: Math.round(SR * seconds) }, () => rand() * amp);
const buf = (...ch: Float32Array[]) => ({ numberOfChannels: ch.length, length: ch[0].length, sampleRate: SR, getChannelData: (i: number) => ch[i] });

// --- Tipos de pista ---
const silent = new Float32Array(SR * 4);
const left = noise(4, 0.3);
const stats = async (...ch: Float32Array[]) => (await measureBuffer(buf(...ch))) as TrackStats;
check("mono → layout mono", (await stats(left)).layout === "mono");
check("estéreo con lo mismo en L y R → se queda estéreo (centro igual que antes)", (await stats(left, left)).layout === "stereo");
check("Guía solo en L → left", (await stats(left, silent)).layout === "left");
check("Guía solo en R → right", (await stats(silent, left)).layout === "right");
check("estéreo real → stereo", (await stats(noise(4, 0.3), noise(4, 0.3))).layout === "stereo");

// --- Nombres: Click y Guía = familia "Guía y Click" ---
check("Click/Guía por nombre (click, clic, metrónomo, cue, guía, guide…)",
  ["Click", "Click Track", "clic", "Metrónomo", "metronomo", "Cue", "Cues", "Guía", "GUIDE", "Voz Guía", "Jubilo - Click"].every(isGuideOrClick) &&
  ["Bajo", "Drums", "Keys 1", "Lead Vox", "Pad", "Electric Guitar"].every((n) => !isGuideOrClick(n)));

// --- Ventana de silencios ---
const burst = (seconds: number, amp: number, activeFrom: number, activeTo: number) =>
  Float32Array.from({ length: Math.round(SR * seconds) }, (_, i) => (i / SR >= activeFrom && i / SR < activeTo ? (rand() * amp) : 0));
const continuous = await stats(noise(20, 0.1));
const withSilences = await stats(burst(20, 0.1, 0, 8)); // suena 8 s y calla 12 s
check("pista con silencios largos: el nivel medido es el de las partes que suenan (no baja por los silencios)", Math.abs(10 * Math.log10(withSilences.power / continuous.power)) < 0.7,
  `${(10 * Math.log10(withSilences.power / continuous.power)).toFixed(2)} dB de diferencia`);
check("las ventanas quedan guardadas (0,4 s cada una)", withSilences.blocks.length === 50, `${withSilences.blocks.length}`);

// --- Plan de normalización ---
const mk = async (amp: number, secs = 20) => await stats(noise(secs, amp));
const names = ["Drums", "Bass", "Keys", "Lead Vox", "Pad", "Click Track", "Guide"];
const amps = [0.3, 0.2, 0.08, 0.12, 0.05, 0.4, 0.15];
const trackStats = await Promise.all(amps.map((a) => mk(a)));
const tracks: PlanTrack[] = names.map((n, i) => ({ excluded: isGuideOrClick(n), stats: trackStats[i] }));
const isMusic = (i: number) => !tracks[i].excluded;
const musicIdx = tracks.map((_, i) => i).filter(isMusic);

const soft = planNormalization(tracks, "soft");
check("Click y Guía: ganancia EXACTAMENTE 1 (0 dB) en los tres modos", (["off", "soft", "level"] as const).every((m) => {
  const p = planNormalization(tracks, m);
  return p.gains[5] === 1 && p.gains[6] === 1;
}));
check("Click y Guía no influyen: cambiar su nivel no cambia el plan de la música", (() => {
  const loud = tracks.map((t, i) => (i === 5 || i === 6 ? { ...t, stats: { ...trackStats[0], peak: 1, power: 0.9, blocks: trackStats[0].blocks.map((b) => b * 100) } } : t));
  const p = planNormalization(loud, "soft");
  return musicIdx.every((i) => p.gains[i] === soft.gains[i]);
})());
check("Suave: UNA sola ganancia para todas las pistas musicales", new Set(musicIdx.map((i) => soft.gains[i].toFixed(9))).size === 1, `${soft.songGainDb.toFixed(2)} dB`);
check("el balance original se conserva (diferencias relativas iguales antes y después)", musicIdx.every((i) => musicIdx.every((j) => {
  const before = 10 * Math.log10(trackStats[i].power / trackStats[j].power);
  const after = 10 * Math.log10((trackStats[i].power * soft.gains[i] ** 2) / (trackStats[j].power * soft.gains[j] ** 2));
  return Math.abs(before - after) < 1e-9;
})));
check("la ganancia respeta ±6 dB", soft.songGainDb <= MAX_GAIN_DB + 1e-9 && soft.songGainDb >= MIN_GAIN_DB - 1e-9);
check("Apagado: todo exactamente 1", planNormalization(tracks, "off").gains.every((g) => g === 1));

// El nivel de la mezcla medido coincide con el de la mezcla real (suma de muestras)
const mixSamples = (list: Float32Array[], gains: number[]) => Float32Array.from(list[0], (_, i) => list.reduce((s, ch, k) => s + ch[i] * gains[k], 0));
const raw = amps.map((a) => noise(20, a));
const rawStats = await Promise.all(raw.map((r) => stats(r)));
const musicRaw = musicIdx.map((i) => raw[i]);
const realMix = mixSamples(musicRaw, musicRaw.map(() => 1));
const realDb = toDb(Math.sqrt(realMix.reduce((s, v) => s + v * v, 0) / realMix.length));
const estDb = mixLevelDb(musicIdx.map((i) => rawStats[i]));
const realPowerDb = 10 * Math.log10(realMix.reduce((s, v) => s + v * v, 0) / realMix.length);
// La mezcla real de pistas mono sale por los dos lados a 0,707: por canal es la mitad de energía (-3 dB), igual que la estimación.
check("nivel de la mezcla estimado = real (±1 dB RMS por canal)", estDb !== null && Math.abs(estDb - (realPowerDb - 10 * Math.log10(2))) < 1, `estimado ${estDb?.toFixed(2)} · real ${(realPowerDb - 3.01).toFixed(2)} dBFS RMS`);

// Techo de pico -1 dBFS en la mezcla musical
const curve = limiterCurve();
const hotAmps = [0.9, 0.9, 0.8, 0.8, 0.7];
const hotRaw = hotAmps.map((a) => noise(20, a));
const hotStats = await Promise.all(hotRaw.map((r) => stats(r)));
const hotPlan = planNormalization(hotStats.map((s) => ({ excluded: false, stats: s })), "soft");
const hotMix = mixSamples(hotRaw, hotPlan.gains);
const peakOf = (x: Float32Array) => { let m = 0; for (const v of x) if (Math.abs(v) > m) m = Math.abs(v); return m; };
const hotPeakDb = toDb(peakOf(hotMix));
// Mezcla realista (pistas independientes que sumadas llegan cerca de plena escala): el plan solo ya cumple el techo.
const realAmps = [0.35, 0.3, 0.25, 0.25, 0.2];
const realRaw = realAmps.map((a) => noise(20, a));
const realPlan = planNormalization(await Promise.all(realRaw.map(async (r) => ({ excluded: false, stats: await stats(r) }))), "soft");
const realPeak = toDb(peakOf(mixSamples(realRaw, realPlan.gains)));
check("mezcla realista: el pico de la mezcla no supera -1 dBFS solo con la ganancia", realPeak <= PEAK_CEILING_DB + 1e-6, `pico ${realPeak.toFixed(2)} dBFS, ganancia ${realPlan.songGainDb.toFixed(2)} dB`);
// Mezcla absurdamente cargada (suma muy por encima de 0 dBFS): el limitador suave del audio sostiene el techo.
const shaped = Float32Array.from(hotMix, (v) => {
  const idx = Math.min(curve.length - 1, Math.max(0, Math.round(((Math.max(-1, Math.min(1, v)) + 1) / 2) * (curve.length - 1))));
  return curve[idx];
});
check("mezcla extrema: con la ganancia (−6 dB) y el limitador suave, el pico nunca pasa de -1 dBFS", toDb(peakOf(shaped)) <= PEAK_CEILING_DB + 1e-6, `sin limitador ${hotPeakDb.toFixed(1)} dBFS → con limitador ${toDb(peakOf(shaped)).toFixed(2)} dBFS`);
const quietMix = planNormalization([{ excluded: false, stats: await mk(0.002) }, { excluded: false, stats: await mk(0.002) }], "soft");
check("mezcla muy baja: sube como máximo +6 dB (no infla el ruido sin límite)", quietMix.songGainDb <= MAX_GAIN_DB + 1e-9, `${quietMix.songGainDb.toFixed(2)} dB`);

// Limitador suave de seguridad (la curva ya se usó arriba)
const knee = Math.pow(10, LIMITER_KNEE_DB / 20);
const ceiling = Math.pow(10, PEAK_CEILING_DB / 20);
let identityOk = true, ceilingOk = true, monotonic = true;
for (let i = 0; i < curve.length; i++) {
  const x = (i / (curve.length - 1)) * 2 - 1;
  if (Math.abs(x) <= knee && Math.abs(curve[i] - x) > 1e-6) identityOk = false;
  if (Math.abs(curve[i]) > ceiling + 1e-6) ceilingOk = false;
  if (i > 0 && curve[i] < curve[i - 1] - 1e-9) monotonic = false;
}
check("limitador: idéntico por debajo de -3 dBFS (no toca la mezcla normal)", identityOk);
check("limitador: nunca supera -1 dBFS ni con la entrada a tope", ceilingOk && toDb(Math.abs(curve[curve.length - 1])) <= PEAK_CEILING_DB + 1e-6, `techo ${toDb(Math.abs(curve[curve.length - 1])).toFixed(3)} dBFS`);
check("limitador: curva creciente (sin inversiones)", monotonic);

// Datos a medias: no se normaliza
const partial = planNormalization(tracks.map((t, i) => (i === 2 ? { ...t, stats: null } : t)), "soft");
check("si falta medir una pista musical no se aplica nada (ganancia 1)", partial.gains.every((g) => g === 1) && partial.reason === "incomplete");
check("sin pistas musicales (solo Click/Guía) → ganancia 1", planNormalization([tracks[5], tracks[6]], "soft").gains.every((g) => g === 1));

// Nivelar pistas: solo pistas MUY fuera de rango, ±6 dB
const levelStats = await Promise.all([0.1, 0.11, 0.09, 0.1, 0.9, 0.0006].map((a) => mk(a)));
const levelTracks: PlanTrack[] = levelStats.map((s) => ({ excluded: false, stats: s }));
levelTracks.push({ excluded: true, stats: await mk(0.5) });
const lvl = planNormalization(levelTracks, "level");
const sft = planNormalization(levelTracks, "soft");
const rel = (i: number) => toDb(lvl.gains[i] / lvl.gains[0]); // respecto de una pista normal del mismo plan (la ganancia común se aplica a todas)
check("Nivelar: pistas normales no se tocan (más allá de la ganancia común)", [0, 1, 2, 3].every((i) => Math.abs(rel(i)) < 1e-6), [0, 1, 2, 3].map((i) => rel(i).toFixed(2)).join(" / "));
check("Suave vs Nivelar: Suave no corrige ninguna pista", new Set([0, 1, 2, 3, 4, 5].map((i) => sft.gains[i].toFixed(9))).size === 1);
check("Nivelar: la pista muy fuerte baja respecto de las demás, con tope de 6 dB", rel(4) < -0.5 && rel(4) >= -MAX_GAIN_DB - 1e-9, `${rel(4).toFixed(2)} dB`);
check("Nivelar: una pista casi en silencio (ruido) NO se sube", Math.abs(rel(5)) < 1e-6, `${rel(5).toFixed(2)} dB`);
check("Nivelar: Click/Guía siguen en 1 exacto", lvl.gains[6] === 1);
check("Nivelar: ninguna ganancia total pasa de ±6 dB", lvl.gains.every((g, i) => i === 6 || (toDb(g) <= MAX_GAIN_DB + 1e-9 && toDb(g) >= MIN_GAIN_DB - 1e-9)));
check("referencia de la mezcla = " + REFERENCE_DB + " dBFS RMS: tras la ganancia la mezcla queda ahí o limitada por ±6 / techo",
  (() => { const g = soft.songGainDb; const target = REFERENCE_DB - (soft.mixDb ?? 0); return Math.abs(g - target) < 1e-9 || g === MAX_GAIN_DB || g === MIN_GAIN_DB || g < target; })());
check("compuerta: ventanas en silencio no cuentan", gatedMeanPower([0, 0, 0.01, 0.01, 0]) === 0.01);

// --- Paneo: potencia de salida total vs posición ---
const power = (layout: Layout, pan: number, L: Float32Array, R: Float32Array) => {
  const [ll, lr, rl, rr] = panTaps(pan, layout);
  let s = 0;
  for (let i = 0; i < L.length; i++) {
    const l = ll * L[i] + rl * R[i];
    const r = lr * L[i] + rr * R[i];
    s += l * l + r * r;
  }
  return s / L.length;
};
const sweep = (layout: Layout, L: Float32Array, R: Float32Array) => {
  const centre = power(layout, 0, L, R);
  const values = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1].map((p) => 10 * Math.log10(power(layout, p, L, R) / centre));
  return { values, span: Math.max(...values) - Math.min(...values), max: Math.max(...values.map(Math.abs)) };
};
const n1 = noise(2, 0.5), n2 = noise(2, 0.5);
const mono = sweep("mono", n1, n1);
const ster = sweep("stereo", n1, n2);
const oneSide = sweep("left", n1, new Float32Array(n1.length));
const rightOnly = sweep("right", new Float32Array(n1.length), n1);
check("mono: energía total ±1 dB de izquierda a derecha", mono.max <= 1, "variación máx " + mono.max.toFixed(2) + " dB");
const near = Float32Array.from(n1, (v, i) => v * 0.9 + n2[i] * 0.1); // estéreo típico: lados parecidos
const sterNear = sweep("stereo", n1, near);
check("estéreo con lados parecidos (lo normal): energía total ±1 dB", sterNear.max <= 1, "variación máx " + sterNear.max.toFixed(2) + " dB");
check("estéreo con lados totalmente distintos: energía ±3,1 dB (sumar L+R en un lado pierde 3 dB, inherente)", ster.max <= 3.1, "variación máx " + ster.max.toFixed(2) + " dB");
const [hLL, hLR, hRL, hRR] = panTaps(-1, "stereo");
check("estéreo a 100 % izquierda: el canal derecho se SUMA al izquierdo y nada sale por la derecha", Math.abs(hLL - Math.SQRT1_2) < 1e-9 && Math.abs(hRL - Math.SQRT1_2) < 1e-9 && hLR === 0 && Math.abs(hRR) < 1e-9);
const [kLL, kLR, kRL, kRR] = panTaps(1, "stereo");
check("estéreo a 100 % derecha: simétrico", Math.abs(kRR - Math.SQRT1_2) < 1e-9 && Math.abs(kLR - Math.SQRT1_2) < 1e-9 && kRL === 0 && Math.abs(kLL) < 1e-9);
const mL = panTaps(-1, "mono");
check("mono a 100 % izquierda: todo por la izquierda, nivel 1 (misma energía que 0,707 por lado)", Math.abs(mL[0] - 1) < 1e-9 && Math.abs(mL[1]) < 1e-9);
check("Guía solo en L: energía ±1 dB", oneSide.max <= 1, "variación máx " + oneSide.max.toFixed(2) + " dB");
check("Guía solo en R: energía ±1 dB", rightOnly.max <= 1, "variación máx " + rightOnly.max.toFixed(2) + " dB");
const c = panTaps(0, "mono");
check("centro mono = 0,707 por lado (igual que antes)", Math.abs(c[0] - Math.SQRT1_2) < 1e-9 && Math.abs(c[1] - Math.SQRT1_2) < 1e-9);
const cs = panTaps(0, "stereo");
check("centro estéreo = pasa tal cual", Math.abs(cs[0] - 1) < 1e-9 && Math.abs(cs[3] - 1) < 1e-9 && cs[1] === 0 && cs[2] === 0);
// La Guía solo en L, al llevar el paneo a la derecha, debe sonar en la derecha
const [llg, lrg] = panTaps(1, "left");
check("Guía solo en L con paneo a la derecha → suena solo a la derecha", llg < 1e-9 && Math.abs(lrg - 1) < 1e-9);
const [, , rlg, rrg] = panTaps(-1, "right");
check("Guía solo en R con paneo a la izquierda → suena solo a la izquierda", Math.abs(rlg - 1) < 1e-9 && rrg < 1e-9);

console.log(failed ? `\n${failed} comprobaciones FALLARON` : "\nTodas las comprobaciones pasaron");
process.exit(failed ? 1 : 0);
