// Verifica las reglas del cierre de sesión por ausencia e inactividad (marcas de tiempo, sin temporizadores) y las constantes de config.ts.
// Uso: node tools/verify-inactivity.ts
import { readFileSync } from "node:fs";
import { absenceExpired, idleExpired, parseLeaveRecord } from "../src/inactivityRules.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

const config = readFileSync(new URL("../src/cloud/config.ts", import.meta.url), "utf8");
const GRACIA = Number(/GRACIA_FUERA_MIN\s*=\s*(\d+)/.exec(config)?.[1]);
const INACT = Number(/INACTIVIDAD_MIN\s*=\s*(\d+)/.exec(config)?.[1]);
check("config.ts: GRACIA_FUERA_MIN = 30 (1.1.0)", GRACIA === 30);
check("config.ts: INACTIVIDAD_MIN = 180 (1.1.0)", INACT === 180);

const MIN = 60_000;
const t0 = 1_700_000_000_000;
const away = (min: number, wasPlaying: boolean, busy = false) => absenceExpired({ leftAt: t0, wasPlaying }, t0 + min * MIN, busy, GRACIA, INACT);

// Sin audio al salir: gracia de GRACIA minutos
check(`sin audio, ${GRACIA - 1} min fuera: sigue la sesión`, !away(GRACIA - 1, false));
check(`sin audio, exactamente ${GRACIA} min: sigue`, !away(GRACIA, false));
check(`sin audio, ${GRACIA + 1} min fuera: se cierra`, away(GRACIA + 1, false));
check("sin audio, 10 min fuera (antes expulsaba): sigue", !away(10, false));
// Con audio al salir: INACT minutos
check("con audio, 61 min fuera (antes expulsaba): sigue", !away(61, true));
check(`con audio, ${INACT - 1} min fuera: sigue`, !away(INACT - 1, true));
check(`con audio, ${INACT + 1} min fuera: se cierra`, away(INACT + 1, true));
// Nunca con audio sonando o descarga en curso al volver
check("mucho tiempo fuera pero suena audio/descarga ahora: no se cierra", !away(INACT * 3, true, true));
check(`${GRACIA + 1} min fuera pero hay descarga ahora: no se cierra`, !away(GRACIA + 1, false, true));
// Sin marca (primer arranque) y marcas imposibles
check("sin marca guardada: no se cierra", !absenceExpired(null, t0, false, GRACIA, INACT));
check("reloj cambiado hacia atrás: no se cierra", !absenceExpired({ leftAt: t0 + 5 * MIN, wasPlaying: false }, t0, false, GRACIA, INACT));

// Primer plano
check("predicación de 90 min sin tocar el celular (antes expulsaba a los 60): sigue", !idleExpired(t0, t0 + 90 * MIN, false, INACT));
check(`${INACT - 1} min sin interacción: sigue`, !idleExpired(t0, t0 + (INACT - 1) * MIN, false, INACT));
check(`${INACT + 1} min sin interacción: se cierra`, idleExpired(t0, t0 + (INACT + 1) * MIN, false, INACT));
check("con audio sonando nunca se cierra por inactividad", !idleExpired(t0, t0 + INACT * 10 * MIN, true, INACT));
check("61 min sin interacción pero suena audio o hay descarga: no se cierra", !idleExpired(t0, t0 + 61 * MIN, true, INACT));

// Marca persistida
check("marca válida se lee", JSON.stringify(parseLeaveRecord('{"leftAt":5,"wasPlaying":true}')) === '{"leftAt":5,"wasPlaying":true}');
check("marca dañada o ausente se ignora", parseLeaveRecord("{roto") === null && parseLeaveRecord(null) === null && parseLeaveRecord('{"leftAt":"x"}') === null);

// Aviso exacto y cierre local (no global)
const gate = readFileSync(new URL("../src/AuthGate.tsx", import.meta.url), "utf8");
check("la pantalla de acceso muestra «Cerramos tu sesión por inactividad»", gate.includes("Cerramos tu sesión por inactividad"));
const auth = readFileSync(new URL("../src/cloud/auth.ts", import.meta.url), "utf8");
check("el cierre de sesión es local (scope: local)", /signOut\(\{ scope: "local" \}\)/.test(auth));

console.log(failed ? `\n${failed} comprobación(es) con FALLA` : "\nTodo en orden");
process.exit(failed ? 1 : 0);
