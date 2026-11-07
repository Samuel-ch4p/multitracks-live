/** Solo en desarrollo: crea canciones de prueba (ondas sintéticas) para ver y medir la interfaz sin archivos reales. */
const NAMES = ["Bateria", "Bajo", "Teclas", "Guitarra", "Coros", "Voz", "Pad", "Cuerdas", "Percusion", "Piano", "Sinte", "Click", "Guia", "Loop", "FX", "Coro 2", "Organo", "Brass"];

export type DemoAudio = { rate?: number; stereo?: boolean };

function wav(seconds: number, freq: number, { rate = 22050, stereo = false }: DemoAudio = {}): Blob {
  const n = Math.floor(seconds * rate);
  const ch = stereo ? 2 : 1;
  const buffer = new ArrayBuffer(44 + n * 2 * ch);
  const v = new DataView(buffer);
  const text = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  text(0, "RIFF"); v.setUint32(4, 36 + n * 2 * ch, true); text(8, "WAVE"); text(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2 * ch, true);
  v.setUint16(32, 2 * ch, true); v.setUint16(34, 16, true); text(36, "data"); v.setUint32(40, n * 2 * ch, true);
  for (let i = 0; i < n; i++) {
    const env = 0.35 + 0.3 * Math.sin((i / rate) * 1.7 + freq);
    const s = Math.sin((2 * Math.PI * freq * i) / rate) * env * 12000;
    v.setInt16(44 + i * 2 * ch, s, true);
    if (stereo) v.setInt16(46 + i * 4, s * 0.8, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** fakeMB: aparenta que la canción ocupa ese tamaño en memoria (para probar el aviso de memoria llena). */
export function makeDemoSong(title: string, trackCount: number, seconds = 60, fakeMB = 0, names: string[] = NAMES, audio: DemoAudio = {}): File[] {
  return names.slice(0, Math.min(trackCount, names.length)).map((name, i) => {
    const file = new File([wav(seconds, 110 * (1 + i * 0.37), audio)], `${title} - ${name}.wav`, { type: "audio/wav" });
    if (fakeMB > 0) Object.defineProperty(file, "size", { value: (fakeMB * 1048576) / trackCount });
    return file;
  });
}

/** Pistas del modo ?demo (nombres con tilde, como en la referencia). */
export const DEMO_TRACK_NAMES = ["Batería", "Bajo", "Teclas", "Guitarra", "Coros", "Click", "Guía", "Pad", "Voz", "Percusión"];
