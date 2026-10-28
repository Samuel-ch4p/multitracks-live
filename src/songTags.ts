/**
 * Tono y BPM a partir del nombre del zip, con expresiones tolerantes. Si no se pueden sacar con seguridad, no se devuelve nada
 * (mejor sin etiqueta que una equivocada). Ejemplos que reconoce:
 *   "Algo Nuevo Empezó - D - 145bpm"  → D · 145      "Algo Nuevo Empezó Ab 130,00 bpm" → Ab · 130
 *   "Cerca De Mi Bb 105"              → Bb · 105     "Cielos Abiertos - C#m - 72 BPM"  → C#m · 72
 *   "Un Dia A La Vez"                 → (nada)       "Canción - Em"                    → Em
 */
export type SongTags = { tone?: string; bpm?: number };

const TONE = "[A-G](?:#|b|♯|♭)?(?:m|min|minor|maj|major)?";
const SEP = "[\\s_\\-–—.,()\\[\\]]";

const cleanTone = (raw: string) =>
  raw.replace("♯", "#").replace("♭", "b").replace(/(minor|min)$/i, "m").replace(/(major|maj)$/i, "");

const validBpm = (value: number) => Number.isFinite(value) && value >= 40 && value <= 260;

export function parseSongTags(fileName: string): SongTags {
  const name = fileName.replace(/\.zip$/i, "").normalize("NFC");
  const tags: SongTags = {};

  // 1) "NNN bpm" explícito (con decimales "130,00" o "130.5"); el tono es el que está justo antes.
  const bpmMatch = name.match(/(\d{2,3}(?:[.,]\d+)?)\s*bpm/i);
  if (bpmMatch) {
    const bpm = Math.round(parseFloat(bpmMatch[1].replace(",", ".")));
    if (validBpm(bpm)) tags.bpm = bpm;
    const before = name.slice(0, bpmMatch.index);
    const tone = before.match(new RegExp(`(?:^|${SEP})(${TONE})${SEP}*$`));
    if (tone) tags.tone = cleanTone(tone[1]);
  } else {
    // 2) "... TONO NNN" al final ("Cerca De Mi Bb 105").
    const tail = name.match(new RegExp(`(?:^|${SEP})(${TONE})${SEP}+(\\d{2,3})${SEP}*$`));
    if (tail && validBpm(Number(tail[2]))) {
      tags.tone = cleanTone(tail[1]);
      tags.bpm = Number(tail[2]);
    }
  }

  // 3) Solo tono: tiene que ser la última palabra del nombre ("Canción - Em"); una "A" suelta en medio es una palabra, no un tono.
  if (!tags.tone) {
    const last = name.match(new RegExp(`(?:^|${SEP})(${TONE})${SEP}*$`));
    if (last && name.trim().length > last[1].length) tags.tone = cleanTone(last[1]);
  }
  return tags;
}
