/**
 * Nombres de entradas de un ZIP. El estándar dice: bit 11 de los flags = UTF-8; si no está, el nombre va en la página de códigos del sistema
 * que creó el ZIP (en Windows en español: CP850, a veces CP437 o windows-1252). Decodificarlo siempre como UTF-8 deja U+FFFD (el rombo)
 * en las tildes: «Gu◆a», «El◆ctrica».
 */

/** Mitad alta (0x80–0xFF) de CP850. TextDecoder no incluye cp850, por eso la tabla es propia. */
const CP850_HIGH =
  "ÇüéâäàåçêëèïîìÄÅ" + // 80
  "ÉæÆôöòûùÿÖÜø£Ø×ƒ" + // 90
  "áíóúñÑªº¿®¬½¼¡«»" + // A0
  "░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐" + // B0
  "└┴┬├─┼ãÃ╚╔╩╦╠═╬¤" + // C0
  "ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀" + // D0
  "ÓßÔÒõÕµþÞÚÛÙýÝ¯´" + // E0
  "­±‗¾¶§÷¸°¨·¹³²■ "; // F0

/** CP437 y CP850 coinciden en las letras del español (á é í ó ú ñ Ñ ü ¿ ¡); solo difieren en mayúsculas acentuadas y símbolos raros. */
export function decodeCp850(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte < 0x80 ? String.fromCharCode(byte) : CP850_HIGH[byte - 0x80];
  return out;
}

const isAscii = (bytes: Uint8Array) => bytes.every((byte) => byte < 0x80);
const BOX_DRAWING = /[─-◿]/; // en un nombre de archivo, casi siempre indica que los bytes NO eran CP850

/** Decodifica el nombre crudo de una entrada ZIP según su flag UTF-8 (bit 11), con respaldos. */
export function decodeZipName(raw: Uint8Array, flags: number): string {
  if (isAscii(raw)) return String.fromCharCode(...raw);
  if (flags & 0x800) return new TextDecoder("utf-8").decode(raw);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw); // sin flag, pero es UTF-8 válido (lo escriben varias herramientas)
  } catch {
    const cp850 = decodeCp850(raw);
    if (!BOX_DRAWING.test(cp850)) return cp850;
    try { return new TextDecoder("windows-1252").decode(raw); } catch { return cp850; }
  }
}
