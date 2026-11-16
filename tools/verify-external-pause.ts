// I5: pausas externas (llamada, alarma, audífonos) → la interfaz refleja «en pausa» y Play reanuda.
// Uso: node tools/verify-external-pause.ts
import { contextInterrupted, isExternalPause } from "../src/externalPause.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

const base = { playing: true, busy: false, stillPaused: true, ended: false, inMixer: true };
check("llamada/alarma: pista pausada por el sistema mientras suena → externa", isExternalPause(base));
check("pausa del usuario (la app ya no cree que suena) → no", !isExternalPause({ ...base, playing: false }));
check("Detener/Reiniciar/mover posición en curso → no", !isExternalPause({ ...base, busy: true }));
check("mover posición: la pista vuelve a sonar en seguida → no", !isExternalPause({ ...base, stillPaused: false }));
check("pista corta que terminó → no", !isExternalPause({ ...base, ended: true }));
check("pista quitada con la × → no", !isExternalPause({ ...base, inMixer: false }));
check("AudioContext suspendido mientras suena → interrupción", contextInterrupted("suspended", true));
check("AudioContext 'interrupted' (iOS) mientras suena → interrupción", contextInterrupted("interrupted", true));
check("AudioContext suspendido sin sonar → nada", !contextInterrupted("suspended", false));
check("AudioContext running → nada", !contextInterrupted("running", true));

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
