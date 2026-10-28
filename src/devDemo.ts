/** Solo en desarrollo: crea canciones de prueba (ondas sintéticas) para ver y medir la interfaz sin archivos reales. */
const NAMES = ["Bateria", "Bajo", "Teclas", "Guitarra", "Coros", "Voz", "Pad", "Cuerdas", "Percusion", "Piano", "Sinte", "Click", "Guia", "Loop", "FX", "Coro 2", "Organo", "Brass"];

function wav(seconds: number, freq: number, rate = 22050): Blob {
  const n = Math.floor(seconds * rate);
  const buffer = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buffer);
  const text = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  text(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); text(8, "WAVE"); text(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const env = 0.35 + 0.3 * Math.sin((i / rate) * 1.7 + freq);
    v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / rate) * env * 12000, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function makeDemoSong(title: string, trackCount: number, seconds = 60): File[] {
  return NAMES.slice(0, Math.min(trackCount, NAMES.length)).map((name, i) => new File([wav(seconds, 110 * (1 + i * 0.37))], `${title} - ${name}.wav`, { type: "audio/wav" }));
}
