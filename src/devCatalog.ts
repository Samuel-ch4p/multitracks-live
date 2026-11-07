import type { Catalog, CatalogSong } from "./cloud/catalog.ts";

/**
 * Solo desarrollo (?catalog=demo): catálogo falso de ~2.460 canciones para probar el buscador sin la nube.
 * Incluye "Cerca de mí", "Él me amó" y "Hillsong". Nada de esto entra al APK (se elimina con import.meta.env.DEV).
 */
export function makeDemoCatalog(): Catalog {
  const names = ["Hillsong Worship", "Elevation Worship", "Miel San Marcos", "Marcos Witt", "Jesús Adrián Romero", "Bethel Music", "Planetshakers", "Gateway Worship", "Barak", "Un Corazón", "Christine DClario", "Averly Morillo", "Redimi2", "Danilo Montero", "Kari Jobe", "Cesar Garza", "Alex Campos", "Lilly Goodman", "Evan Craft", "Maverick City"];
  const artists = names.map((name, i) => ({ id: `a${i}`, name, aliases: [] as string[] }));
  const words = ["Cerca", "de", "mí", "Él", "me", "amó", "Gloria", "Santo", "Rey", "Fuego", "Aliento", "Todo", "nuevo", "Despertar", "Sin", "miedo", "Reina", "Roca", "Pan", "Vida", "Eterno", "Mi", "Refugio", "Poderoso", "Dios", "Alabanza", "Libre", "Cielo", "Tierra", "Nombre"];
  const tones = ["C", "D", "E", "F", "G", "A", "B", "Gm", "Am", "Dm", null];
  const songs: CatalogSong[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 2460; i++) {
    const n = 2 + Math.floor(rnd() * 3);
    const title = Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(" ");
    const artistId = `a${Math.floor(rnd() * artists.length)}`;
    songs.push({ id: `s${i}`, artistId, title, key: `library/${artistId}/${i}.zip`, size: 60e6 + Math.floor(rnd() * 200e6), format: i % 11 === 0 ? "rar" : "zip", bpm: 60 + Math.floor(rnd() * 90), tone: tones[Math.floor(rnd() * tones.length)], modTime: null });
  }
  songs.push({ id: "s-cerca", artistId: "a0", title: "Cerca de mí", key: "library/a0/cerca.zip", size: 90e6, format: "zip", bpm: 72, tone: "G", modTime: null });
  songs.push({ id: "s-amo", artistId: "a2", title: "Él me amó", key: "library/a2/amo.zip", size: 90e6, format: "zip", bpm: 68, tone: "D", modTime: null });
  return { version: 1, generatedAt: "dev", artists, songs };
}
