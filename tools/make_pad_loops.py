# Convierte los pads largos (MP3 de 20 min) en ciclos de 32 s sin corte, ya normalizados y en OGG.
# Uso: python3 tools/make_pad_loops.py public/pads   (ajusta U y SRC con la ruta y nombres de tus MP3; requiere ffmpeg, numpy)
# Para menores o sostenidos: agrega la entrada en SRC (p. ej. "Cm": "Cm.mp3") y en SAMPLES de src/pads.ts.
import subprocess, sys, numpy as np, wave, os
U = "/root/.claude/uploads/33ac6054-58c6-5a97-8e93-b4ccc2940ea9"
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
SRC = {"C": "87dfc431-C.mp3", "D": "1b94eb37-D.mp3", "E": "3286e2c6-E.mp3", "F": "66b8a446-F.mp3",
       "G": "6ed4aaff-G.mp3", "A": "48a8ddda-A.mp3", "B": "dfce35ca-B.mp3"}
SR = 44100; START = 600; LOOP = 32; XF = 6; TARGET_RMS = 10 ** (-19 / 20)
for note, name in SRC.items():
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(START), "-t", str(LOOP + XF), "-i", f"{U}/{name}", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)
    n, f = LOOP * SR, XF * SR
    loop = x[:n].copy(); tail = x[n:n + f]
    t = np.linspace(0, 1, f)[:, None]
    # El final del ciclo continúa con lo que venía después; se mezcla sobre el comienzo (potencia pareja).
    loop[:f] = loop[:f] * np.sin(t * np.pi / 2) + tail * np.cos(t * np.pi / 2)
    rms = np.sqrt((loop ** 2).mean()); loop *= TARGET_RMS / rms
    peak = np.abs(loop).max()
    if peak > 0.9: loop *= 0.9 / peak
    # control de empalme: salto entre la última y la primera muestra frente al salto típico
    seam = np.abs(loop[0] - loop[-1]).max(); typical = np.abs(np.diff(loop, axis=0)).max()
    w = wave.open(f"{note}.wav", "wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(loop, -1, 1) * 32767).astype(np.int16).tobytes()); w.close()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{note}.wav", "-c:a", "libvorbis", "-q:a", "4", f"{OUT}/{note}.ogg"], check=True)
    print(note, "rms", round(20 * np.log10(np.sqrt((loop ** 2).mean())), 1), "dB  pico", round(peak, 2), " empalme", round(seam, 4), "vs salto máx", round(typical, 4), "ogg", os.path.getsize(f"{OUT}/{note}.ogg") // 1024, "KB")
