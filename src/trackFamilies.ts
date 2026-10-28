/**
 * Familias de color del mezclador. Para añadir o cambiar nombres, edita SOLO las listas KEYWORDS de abajo.
 * Los colores salen de las variables --fam-* de styles/tokens.css (aquí solo se referencian: ningún color se escribe fuera de tokens.css).
 *
 * Cómo se reconoce: el nombre de la pista se pasa a minúsculas sin tildes, se parte en palabras y cada palabra
 * (sin los números del final) se compara con las listas. Palabras de 4+ letras: basta con que EMPIECEN igual
 * ("bater" → batería, bateria2); palabras cortas (kick, pad, vox…): deben ser iguales (o con "s"/número).
 * Si coincide con varias familias manda este orden: guía/click → voces → ritmo → armonía.
 */
export type Family = "guide" | "vocal" | "rhythm" | "harmony" | "neutral";

export const FAMILY_COLORS: Record<Family, { color: string; rgb: string }> = {
  rhythm: { color: "var(--fam-rhythm)", rgb: "var(--fam-rhythm-rgb)" },
  harmony: { color: "var(--fam-harmony)", rgb: "var(--fam-harmony-rgb)" },
  guide: { color: "var(--fam-guide)", rgb: "var(--fam-guide-rgb)" },
  vocal: { color: "var(--fam-vocal)", rgb: "var(--fam-vocal-rgb)" },
  neutral: { color: "var(--fam-neutral)", rgb: "var(--fam-neutral-rgb)" },
};

const KEYWORDS: Record<Exclude<Family, "neutral">, string[]> = {
  // Guía y Click (morado)
  guide: ["guia", "guide", "cue", "cues", "click", "clic", "metronomo", "metronome", "count", "countoff", "conteo", "talkback"],
  // Voces: coros y voz líder (rosado)
  vocal: ["voz", "voces", "vox", "vocal", "vocals", "vocales", "coro", "coros", "bgv", "bgvs", "bv", "bvs", "choir", "backing", "cantante", "singer"],
  // Ritmo: batería, percusión, loops (rojo)
  rhythm: [
    "bateria", "drum", "drums", "kick", "bombo", "snare", "caja", "tom", "toms", "hihat", "hat", "hats", "overhead", "overheads", "oh",
    "ride", "crash", "cymbal", "cymbals", "platillo", "platillos", "perc", "percusion", "percussion", "loop", "loops", "shaker", "tambourine",
    "tamb", "conga", "congas", "bongo", "bongos", "clap", "claps", "cajon", "timbal", "timbales", "ritmo", "rhythm", "groove", "sample", "samples",
  ],
  // Armonía: guitarras, bajo, teclas, pads (azul eléctrico)
  harmony: [
    "guitarra", "guitarras", "guitar", "guitars", "gtr", "gtrs", "acustica", "acoustic", "electrica", "electric", "bajo", "bass", "teclas", "teclado",
    "keys", "key", "keyboard", "piano", "organo", "organ", "synth", "synths", "sinte", "sintetizador", "pad", "pads", "strings", "cuerdas", "rhodes",
    "wurli", "arp", "armonia", "harmony", "metales", "brass", "horn", "horns", "sax", "trompeta", "violin", "cello", "ukulele", "banjo", "mandolina",
  ],
};

const ORDER: Exclude<Family, "neutral">[] = ["guide", "vocal", "rhythm", "harmony"];

const matches = (word: string, keyword: string) =>
  keyword.length >= 4 ? word.startsWith(keyword) : word === keyword || word === `${keyword}s`;

export function familyOf(name: string): Family {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => word.replace(/\d+$/, ""))
    .filter(Boolean);
  for (const family of ORDER) {
    if (words.some((word) => KEYWORDS[family].some((keyword) => matches(word, keyword)))) return family;
  }
  return "neutral";
}

/**
 * Paneo inicial de cada pista al cargar la canción (-1 = 100 % izquierda, 0 = centro).
 * Las pistas de la familia "Guía y Click" (lista `guide` de arriba) arrancan a la izquierda; el resto, al centro.
 * Es solo el valor inicial: el usuario puede moverlo.
 */
export function defaultPan(name: string): number {
  return isGuideOrClick(name) ? -1 : 0;
}

/** Click y Guía (familia "guide" de las listas de arriba): quedan fuera de la normalización y arrancan a la izquierda. */
export const isGuideOrClick = (name: string) => familyOf(name) === "guide";
