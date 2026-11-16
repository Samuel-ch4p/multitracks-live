// P4: quitar la canción activa pasa a la siguiente (o a la anterior si era la última), no a la primera.
// Uso: node tools/verify-playlist-nav.ts
import { indexAfterRemoval } from "../src/playlistNav.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? " · " + detail : ""}`);
};

const songs = ["A", "B", "C", "D", "E"];
const remove = (list: string[], name: string) => ({ next: list.filter((s) => s !== name), index: list.indexOf(name) });
const after = (name: string, skip?: (s: string) => boolean) => { const { next, index } = remove(songs, name); const i = indexAfterRemoval(next, index, skip); return i < 0 ? null : next[i]; };

check("quitar C (en medio) → D, no A", after("C") === "D");
check("quitar A (primera) → B", after("A") === "B");
check("quitar E (última) → D (la anterior)", after("E") === "D");
check("quitar C con D marcada «No se pudo cargar» → E", after("C", (s) => s === "D") === "E");
check("quitar E con D marcada → C", after("E", (s) => s === "D") === "C");
check("quitar la única → lista vacía (-1)", indexAfterRemoval([], 0) === -1);

console.log(failed ? `\n${failed} FALLA(S)` : "\nTodo en orden");
if (failed) process.exit(1);
