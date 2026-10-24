// Verificación de la normalización y del reparto de paneo (sin navegador).
// Uso:  node tools/verify-normalize.ts      (Node 22.6+ con --experimental-strip-types, o Node 24)
import { measureBuffer, planGains, toDb, trackKind, type TrackStats } from "../src/analysis.ts";
import { panTaps, type Layout } from "../src/panLaw.ts";

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

// --- Nombres ---
check("Click/Guía por nombre", trackKind("Jubilo - Click") === "click" && trackKind("GUÍA") === "guide" && trackKind("Guia voz") === "guide" &&
  trackKind("Guitarra") === "music" && trackKind("Bajo") === "music" && trackKind("Clicker Keys") === "music");

// --- Normalización ---
const mk = async (amp: number, secs = 6) => await stats(noise(secs, amp));
const quiet = await mk(0.02);
const mid = await mk(0.1);
const loud = await mk(0.8);
const items = [quiet, mid, loud].map((s) => ({ kind: "music" as const, stats: s }));
const plan = planGains(items);
const outDb = items.map((it, i) => toDb(Math.sqrt(it.stats.power) * (plan.gains[i] / plan.global)));
check("pistas dispares quedan al mismo nivel (±0,5 dB, salvo tope +12 dB / pico)", Math.max(...outDb) - Math.min(...outDb) < 0.5 || toDb(plan.gains[0] / plan.global) >= 11.9,
  outDb.map((d) => d.toFixed(1)).join(" / ") + " dB");
check("subida máxima +12 dB", plan.gains.every((g) => toDb(g / plan.global) <= 12.01), plan.gains.map((g) => toDb(g / plan.global).toFixed(1)).join(" / "));
check("pico por pista ≤ -1 dBFS", items.every((it, i) => toDb(it.stats.peak * (plan.gains[i] / plan.global)) <= -0.99));
const hot = await stats(noise(4, 0.2), noise(4, 0.2));
check("estéreo: deja +3 dB de margen para el paneo extremo (pico ≤ -1 dBFS con el lado a √2)", toDb(hot.peak * planGains([{ kind: "music", stats: hot }]).gains[0] * Math.SQRT2) <= -0.99);

const many = Array.from({ length: 14 }, () => ({ kind: "music" as const, stats: mid }));
const bigPlan = planGains(many);
const mixPower = toDb(Math.sqrt(many.reduce((s, it, i) => s + it.stats.power * bigPlan.gains[i] ** 2, 0)));
check("14 pistas: baja todo por igual y la mezcla no pasa de -14 dB de potencia", bigPlan.global < 1 && mixPower <= -13.99 && new Set(bigPlan.gains.map((g) => g.toFixed(6))).size === 1,
  `global ${toDb(bigPlan.global).toFixed(1)} dB, mezcla ${mixPower.toFixed(1)} dB`);
const fewPlan = planGains(many.slice(0, 2));
check("2 pistas: sin reducción global", fewPlan.global === 1);

const clickStats = await stats(Float32Array.from({ length: SR * 4 }, (_, i) => (i % 11025 < 50 ? 0.3 : 0)));
const guideStats = await mk(0.05);
const mixed = planGains([{ kind: "music", stats: mid }, { kind: "click", stats: clickStats }, { kind: "guide", stats: guideStats }]);
const clickOut = toDb(clickStats.peak * mixed.gains[1] / mixed.global);
const guideOut = toDb(Math.sqrt(guideStats.power) * mixed.gains[2] / mixed.global);
check("Click a -6 dBFS de pico y Guía a -20 dB (fijos, sin ser como los instrumentos)", Math.abs(clickOut + 6) < 0.1 && Math.abs(guideOut + 20) < 0.1, `click ${clickOut.toFixed(1)} · guía ${guideOut.toFixed(1)}`);
check("pista en silencio / sin medir → ganancia 1", planGains([{ kind: "music", stats: null }, { kind: "music", stats: { layout: "mono", peak: 0, power: 0 } }]).gains.every((g) => g === 1));

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
