#!/usr/bin/env python3
"""Convierte un pad largo (mp3/wav de varios minutos) en un bucle corto SIN corte, en .ogg.

Uso:   python3 tools/make_pad_loop.py ENTRADA.mp3 src/assets/pads/C.ogg [inicio_s] [largo_s] [cruce_s]
Nombres de salida que entiende la app: C.ogg D.ogg ... B.ogg (mayores),
  Cs.ogg (C sostenido), Cm.ogg (C menor), Csm.ogg (C sostenido menor), y así con cada nota.
Requiere ffmpeg y numpy. El bucle se hace mezclando el final con el principio (potencia pareja),
y todos los pads se nivelan al mismo volumen.
"""
import subprocess, sys
import numpy as np

SR = 44100
src, dst = sys.argv[1], sys.argv[2]
start = float(sys.argv[3]) if len(sys.argv) > 3 else 120.0
length = float(sys.argv[4]) if len(sys.argv) > 4 else 40.0
xfade = float(sys.argv[5]) if len(sys.argv) > 5 else 8.0
TARGET_RMS = 0.12

raw = subprocess.run(
    ["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(length + xfade), "-i", src,
     "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
    check=True, capture_output=True).stdout
x = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()
L, X = int(length * SR), int(xfade * SR)
if len(x) < L + X:
    sys.exit(f"El audio es demasiado corto ({len(x) / SR:.1f} s) para {length + xfade:.0f} s")

t = np.linspace(0, np.pi / 2, X)[:, None]
head, tail = x[:X], x[L:L + X]
loop = x[:L].copy()
loop[:X] = head * np.sin(t) + tail * np.cos(t)        # el final del bucle se funde con su principio

rms = float(np.sqrt((loop ** 2).mean()))
loop *= TARGET_RMS / max(rms, 1e-6)
peak = float(np.abs(loop).max())
if peak > 0.85:
    loop *= 0.85 / peak
seam = float(np.abs(loop[0] - loop[-1]).max())
step = float(np.abs(np.diff(loop, axis=0)).max())
print(f"{dst}: bucle {length:.0f} s, RMS {np.sqrt((loop ** 2).mean()):.3f}, pico {np.abs(loop).max():.2f}, salto en la unión {seam:.4f} (máx. normal {step:.4f})")

subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-",
                "-c:a", "libvorbis", "-q:a", "4", dst], input=loop.astype("<f4").tobytes(), check=True)
