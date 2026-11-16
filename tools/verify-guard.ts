// I1: cambiar de canción mientras suena exige mantener pulsado; detenida, cambio inmediato.
// Uso: node tools/verify-guard.ts
import { LIVE_GUARD, switchNeedsHold } from "../src/liveGuard.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

check("sonando + otra canción: hay que mantener pulsado", switchNeedsHold(true, 1, 2));
check("sonando + la misma canción: un toque (no corta nada)", !switchNeedsHold(true, 1, 1));
check("detenida: cambio inmediato", !switchNeedsHold(false, 1, 2));
check("sin canción activa: cambio inmediato", !switchNeedsHold(false, null, 2));
check("guardia desactivada (switchSong: false): cambio inmediato aunque suene", !switchNeedsHold(true, 1, 2, { switchSong: false }));
check("tiempo de pulsación razonable (300–1000 ms)", LIVE_GUARD.holdMs >= 300 && LIVE_GUARD.holdMs <= 1000, `${LIVE_GUARD.holdMs} ms`);

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
