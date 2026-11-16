// I4: arranque sin red. Solo con una validación reciente (< 72 h) de la misma cuenta en este teléfono.
// Uso: node tools/verify-offline.ts
import { setCloudStorage } from "../src/cloud/storage.ts";
import { OFFLINE_MAX_H, clearValidation, offlineAllowed, parseValidation, readValidation, saveValidation } from "../src/offlineAccess.ts";

const mem = new Map<string, string>();
setCloudStorage({
  async get(key) { return mem.get(key) ?? null; },
  async set(key, value) { mem.set(key, value); },
  async remove(key) { mem.delete(key); },
});

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

const H = 3_600_000;
const t0 = 1_800_000_000_000;
const v = { userId: "u1", email: "a@b.co", at: t0 };

check("plazo: 72 h", OFFLINE_MAX_H === 72);
check("validada hace 1 h: se abre sin red", offlineAllowed(v, "u1", t0 + H));
check("validada hace 71 h: se abre sin red", offlineAllowed(v, "u1", t0 + 71 * H));
check("validada hace 73 h: NO (hay que conectarse)", !offlineAllowed(v, "u1", t0 + 73 * H));
check("sin validación guardada: NO", !offlineAllowed(null, "u1", t0));
check("validación de OTRA cuenta: NO", !offlineAllowed(v, "u2", t0 + H));
check("sesión guardada desconocida (token vencido): vale la del registro", offlineAllowed(v, null, t0 + H));
check("marca del futuro (reloj adelantado al validar): NO", !offlineAllowed(v, "u1", t0 - H));
check("marca dañada: se ignora", parseValidation("{no es json") === null && parseValidation(JSON.stringify({ at: 5 })) === null);
check("la marca no guarda tokens (solo usuario, correo y hora)", Object.keys(parseValidation(JSON.stringify({ ...v, access_token: "x" })) ?? {}).sort().join(",") === "at,email,userId");

await saveValidation("u1", "a@b.co", t0);
check("se guarda al validar con el servidor", (await readValidation())?.userId === "u1");
check("…y no contiene ningún token", !/token|eyJ/i.test(mem.get("crescendo.validado.v1") ?? ""));
await clearValidation();
check("al cerrar sesión o si el servidor rechaza la cuenta, se borra", (await readValidation()) === null);

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
