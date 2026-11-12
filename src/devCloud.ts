/**
 * Solo en desarrollo: nube falsa para probar la ventana de memoria sin servidor. Una canción con llave «dev://…» "se descarga" en unos
 * segundos (con progreso) y devuelve pistas WAV pequeñas (reales y reproducibles); el tamaño que cuenta para el presupuesto es el del catálogo falso (ver commitLoaded).
 * `window.__devNet` permite simular fallos de red. Todo este archivo se elimina del APK (import.meta.env.DEV).
 */
import { makeDemoSong } from "./devDemo";
import { CloudError } from "./cloud/errors";
import type { CatalogSong, SongProgress } from "./cloud/cloudSource";

export type DevNet = { failNext: number; failKind: "network" | "server" | "usage_limit" | "not_found"; msPerMB: number; log: string[]; real: boolean };
/** real = true: las pistas tienen el tamaño real del catálogo falso (para medir RAM de verdad); false: pistas pequeñas con tamaño de catálogo falso. */
const net: DevNet = { failNext: 0, failKind: "network", msPerMB: 12, log: [], real: false };
if (typeof window !== "undefined") (window as unknown as { __devNet: DevNet }).__devNet = net;

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(new CloudError("cancelled")); }, { once: true });
});

export async function devFetchSongFiles(song: CatalogSong, onProgress: (p: SongProgress) => void, signal: AbortSignal): Promise<File[]> {
  net.log.push(`inicio ${song.title} @${Math.round(performance.now())}`);
  const mb = song.size / 1048576;
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await sleep((mb * net.msPerMB) / steps, signal);
    if (net.failNext > 0 && i === 4) { net.failNext--; net.log.push(`fallo ${song.title} @${Math.round(performance.now())}`); throw new CloudError(net.failKind, 0, {}, "sin datos"); }
    onProgress({ stage: "download", received: Math.round((song.size * i) / steps), total: song.size });
  }
  const tracks = 8;
  // real: bytes de verdad (WAV mono 22,05 kHz de la duración necesaria); si no, 90 s por pista
  const seconds = net.real ? Math.max(1, (song.size / tracks - 44) / (22050 * 2)) : 90;
  const files = makeDemoSong(song.title, tracks, seconds);
  for (let i = 1; i <= tracks; i++) onProgress({ stage: "extract", done: i, total: tracks });
  net.log.push(`listo ${song.title}`);
  return files;
}
