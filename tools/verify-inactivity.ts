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
check("config.ts: GRACIA_FUERA_MIN = 10", GRACIA === 10);
check("config.ts: INACTIVIDAD_MIN = 60", INACT === 60);

const MIN = 60_000;
const t0 = 1_700_000_000_000;
const away = (min: number, wasPlaying: boolean, busy = false) => absenceExpired({ leftAt: t0, wasPlaying }, t0 + min * MIN, busy, GRACIA, INACT);

// Sin audio al salir: gracia de 10 minutos
check("sin audio, 9 min fuera: sigue la sesión", !away(9, false));
check("sin audio, exactamente 10 min: sigue", !away(10, false));
check("sin audio, 11 min fuera: se cierra", away(11, false));
check("sin audio, 3 horas fuera: se cierra", away(180, false));
// Con audio al salir: 60 minutos
check("con audio, 30 min fuera: sigue", !away(30, true));
check("con audio, 59 min fuera: sigue", !away(59, true));
check("con audio, 61 min fuera: se cierra", away(61, true));
// Nunca con audio sonando o descarga en curso al volver
check("61 min fuera pero suena audio/descarga ahora: no se cierra", !away(61, true, true));
check("11 min fuera pero hay descarga ahora: no se cierra", !away(11, false, true));
// Sin marca (primer arranque) y marcas imposibles
check("sin marca guardada: no se cierra", !absenceExpired(null, t0, false, GRACIA, INACT));
check("reloj cambiado hacia atrás: no se cierra", !absenceExpired({ leftAt: t0 + 5 * MIN, wasPlaying: false }, t0, false, GRACIA, INACT));

// Primer plano
check("59 min sin interacción: sigue", !idleExpired(t0, t0 + 59 * MIN, false, INACT));
check("61 min sin interacción: se cierra", idleExpired(t0, t0 + 61 * MIN, false, INACT));
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
