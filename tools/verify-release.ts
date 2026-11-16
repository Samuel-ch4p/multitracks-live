// Coherencia de la versión publicable: versionCode/versionName del APK, versión en Ajustes y verificación del certificado en Actions.
// Uso: node tools/verify-release.ts
import { readFileSync } from "node:fs";
import { APP_VERSION } from "../src/appVersion.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf-8");

const gradle = read("android/app/build.gradle");
const code = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
const name = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
check("versionCode mayor que el publicado (1)", code >= 2, `versionCode ${code}`);
check("versionName = versión en Ajustes", name === APP_VERSION, `${name} / ${APP_VERSION}`);

const workflow = read(".github/workflows/android.yml");
const EXPECTED = "c887bc05194f3d56db3148cda9f5b7efaac075294d42ed3ebb791e551573f4ec";
check("Actions compara el SHA-256 con el certificado esperado", workflow.includes(`EXPECTED="${EXPECTED}"`));
check("…y falla (exit 1) si no coincide", /if \[ "\$GOT" != "\$EXPECTED" \]; then[\s\S]*?exit 1/.test(workflow));
check("…antes de subir el APK", workflow.indexOf('EXPECTED="') < workflow.indexOf("actions/upload-artifact"));

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
