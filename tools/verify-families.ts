// Verifica el mapa de nombres de pista → familia de color (src/trackFamilies.ts).
// Uso: node tools/verify-families.ts
import { familyOf, type Family } from "../src/trackFamilies.ts";

const cases: [string, Family][] = [
  ["Batería", "rhythm"], ["Bateria 2", "rhythm"], ["Kick In", "rhythm"], ["SNARE", "rhythm"], ["Overheads", "rhythm"], ["HiHat", "rhythm"],
  ["Percusión", "rhythm"], ["Perc 1", "rhythm"], ["Loops", "rhythm"], ["Loop_03", "rhythm"], ["Toms", "rhythm"], ["Shaker", "rhythm"],
  ["Guitarra", "harmony"], ["Guitarra Eléctrica 2", "harmony"], ["Acoustic Gtr", "harmony"], ["Bajo", "harmony"], ["Bass", "harmony"],
  ["Teclas", "harmony"], ["Keys", "harmony"], ["Piano", "harmony"], ["Synth Pad", "harmony"], ["Pads", "harmony"], ["Strings", "harmony"], ["Cuerdas", "harmony"],
  ["Click", "guide"], ["Guía", "guide"], ["GUIDE", "guide"], ["Cues", "guide"], ["Metrónomo", "guide"], ["Voz Guía", "guide"], ["Count Off", "guide"],
  ["Coros", "vocal"], ["Voz líder", "vocal"], ["Lead Vox", "vocal"], ["BGV 1", "vocal"], ["Vocals", "vocal"], ["Backing Vocals", "vocal"], ["Choir", "vocal"],
  ["FX", "neutral"], ["Ambiente", "neutral"], ["Track 01", "neutral"], ["Cuevas", "neutral"],
];

let failed = 0;
for (const [name, expected] of cases) {
  const got = familyOf(name);
  if (got !== expected) { failed++; console.log(`FALLA ${name}: esperaba ${expected}, dio ${got}`); }
}
console.log(failed ? `${failed} fallaron` : `OK · ${cases.length} nombres`);
process.exit(failed ? 1 : 0);
