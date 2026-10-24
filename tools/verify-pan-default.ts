// Paneo inicial al cargar la canción: Click y Guía a la izquierda (-1), el resto al centro (0).
// Usa la misma función (defaultPan) que App.tsx aplica al crear cada pista. Uso: node tools/verify-pan-default.ts
import { defaultPan } from "../src/trackFamilies.ts";

let failed = 0;
const song = ["Test - Bajo", "Test - Click", "Test - Guía", "Test - Batería", "Test - Voz líder", "Test - Pad", "Test - Metrónomo", "Test - Cues", "Test - GUIDE", "Test - Cue-Click", "Test - Teclas", "Test - Cuevas"];
const want: Record<string, number> = { "Test - Click": -1, "Test - Guía": -1, "Test - Metrónomo": -1, "Test - Cues": -1, "Test - GUIDE": -1, "Test - Cue-Click": -1 };
for (const name of song) {
  const expected = want[name] ?? 0;
  const got = defaultPan(name);
  if (got !== expected) { failed++; console.log(`FALLA ${name}: esperaba ${expected}, dio ${got}`); }
}
console.log(failed ? `${failed} fallaron` : `OK · ${song.length} pistas (Click/Guía en -1, el resto en 0)`);
process.exit(failed ? 1 : 0);
