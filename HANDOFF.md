# Crescendo Live · notas de traspaso

Para continuar el proyecto en otra cuenta de Claude: sube este archivo (o el ZIP completo) y di "sigue desde HANDOFF.md".

## Qué es
Reproductor/mezclador multitrack en vivo. React 19 + Vite + TypeScript, empaquetado como APK con Capacitor (sin servidor, offline).
Fuentes de canciones: carpeta de MEGA (fija en la app) y archivos del celular (audios sueltos, ZIP, RAR).

## Cómo correrlo
- PC: `npm.cmd install` y luego `npm.cmd run dev -- --host 0.0.0.0` (requiere Node LTS en el PATH).
- APK: subir a GitHub; el workflow `.github/workflows/android.yml` compila y deja el APK en Actions (artefacto `crescendo-live-apk`).
- Comprobar antes de entregar: `npx tsc -b`, `npx oxlint src`, `npm run build`, `npx cap sync android`.

## Mapa del código (src/)
- `App.tsx`: estado general, audio de pistas (Web Audio), pestañas Biblioteca / Live / Mezcla, cabecera con BPM/CLICK/reloj/transporte.
- `metronome.ts` + `Click.tsx`: click con reloj de audio (BPM 30–300, pulsos, subdivisión, acento, sonido, salida mezclada o solo izquierdo, volumen). Ajustes guardados en localStorage.
- `Fader.tsx`, `Pan.tsx`, `Waveform.tsx`: controles táctiles propios.
- `LocalImport.tsx`, `MegaBrowser.tsx`, `archive.ts`: importación (RAR con libarchive.js; ZIP con fflate; MEGA con megajs).
- `App.css`: diseño de vidrio azul marino basado en el Figma del usuario. Hay modos: escritorio, celular vertical, celular horizontal (barra de pestañas lateral).
- `pads.ts` / `Pads.tsx`: motor y panel del pad (capas saw con desafine + sine, filtro con LFO lento, reverb larga generada, fundido cruzado al cambiar de acorde; tocar la misma nota o APAGAR lo apaga con fundido).
- Logo de la cabecera: `src/assets/logo.png` va a 192 px a propósito (se muestra a 42 px; una imagen mucho más grande se ve pixelada al reducirla). El emblema del inicio es `emblem.png` (1024 px).
- `Splash.tsx`: pantalla de inicio (se salta sola en navegadores de prueba con `navigator.webdriver`).
- `assets/` y `public/`: logo (ícono marino con "C" plateada). `assets/` en la raíz alimenta `@capacitor/assets`.

## Decisiones
- Nombre: Crescendo Live. appId: `com.redline.multitracks` (no cambiar: el APK nuevo se instala encima del anterior).
- El link de MEGA ya no se muestra ni se edita; la app solo tiene el botón CONECTAR. Vive en `MegaBrowser.tsx` (`MEGA_LINK`). Sigue dentro del código del APK: quien sepa extraerlo podría verlo.
- El diseño base viene de un proyecto de Figma Make (carpeta `Diseno`); el usuario quiere que la app se vea como ese diseño.
- El usuario trabaja paso a paso: un cambio pequeño a la vez, sin saltar adelante.

## Hecho
Mezclador (volumen, paneo, mute, solo), forma de onda con búsqueda, repertorio, click/metrónomo, importación MEGA + local, logo, rediseño Figma, link de MEGA oculto, pads (`pads.ts` + `Pads.tsx`: notas C–B, botón ♯ y botón m, pad ambiental sostenido estilo adoración con fundidos, volumen propio; el botón PAD de la cabecera abre el panel: junto al mezclador en pantalla ancha, como cajón en celular), pantalla de inicio (`Splash.tsx`: emblema plateado, CRESCENDO LIVE, "Preparando tu experiencia musical…", ~4 s, un toque la salta; copia el video de referencia del usuario, sin el sonido).

## Pendiente (en este orden)
1. Afinar el sonido del pad al oído en el celular real (constantes arriba de `pads.ts`: FADE_IN, FADE_CHANGE, FADE_OUT_STOP, TAIL_STOP; filtro 760 Hz, reverb 6.5 s). Ya ajustado tras pruebas del usuario: timbre más suave (triangulares + sine, sin desafinar), más reverb, apagado en ~1,6 s y cruce entre acordes de potencia constante sin clics.
2. Ideas: tonalidad de cada canción, secciones (Intro/Verso/Coro) en la forma de onda, sincronizar click con la canción, APK firmado de release.

## Sin verificar en dispositivo real
Sonido del click, salida solo-izquierda por una interfaz USB (AudioBox iTwo no fue reconocida por el celular en pruebas previas: tema aparte).
