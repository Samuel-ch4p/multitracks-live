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
- `padEngine.ts` / `Pads.tsx`: pads con AUDIOS DEL USUARIO (el sintetizador anterior sonaba con interferencias y se descartó). `public/pads/*.ogg` son ciclos de 32 s sin corte hechos con `tools/make_pad_loops.py` a partir de MP3 de 20 min (C D E F G A B, mayores). El motor decodifica, repite en bucle y cruza acordes con potencia pareja; apagado en ~0,8 s. Los botones ♯ y m quedan deshabilitados ("PRONTO") hasta que haya audios: para añadirlos, convertir el MP3 con el script, poner el .ogg en `public/pads/` y añadir la línea en `SAMPLES` de `padEngine.ts` (clave `Cm`, `C♯`, `C♯m`).
- Logo de la cabecera: `src/assets/logo.png` va a 192 px a propósito (se muestra a 42 px; una imagen mucho más grande se ve pixelada al reducirla). El emblema del inicio es `emblem.png` (1024 px).
- `Splash.tsx`: pantalla de inicio (se salta sola en navegadores de prueba con `navigator.webdriver`).
- `assets/` y `public/`: logo (ícono marino con "C" plateada). `assets/` en la raíz alimenta `@capacitor/assets`.

## Decisiones
- Nombre: Crescendo Live. appId: `com.redline.multitracks` (no cambiar: el APK nuevo se instala encima del anterior).
- El link de MEGA ya no se muestra ni se edita; la app solo tiene el botón CONECTAR. Vive en `MegaBrowser.tsx` (`MEGA_LINK`). Sigue dentro del código del APK: quien sepa extraerlo podría verlo.
- El diseño base viene de un proyecto de Figma Make (carpeta `Diseno`); el usuario quiere que la app se vea como ese diseño.
- El usuario trabaja paso a paso: un cambio pequeño a la vez, sin saltar adelante.

## Hecho
Mezclador (volumen, paneo, mute, solo), forma de onda con búsqueda, repertorio, click/metrónomo, importación MEGA + local, logo, rediseño Figma, link de MEGA oculto, pads (`padEngine.ts` + `Pads.tsx`, con audios del usuario; botón PAD abre el panel: junto al mezclador en pantalla ancha, como cajón en celular), pantalla de inicio (`Splash.tsx`: emblema plateado, CRESCENDO LIVE, "Preparando tu experiencia musical…", ~4 s, un toque la salta; copia el video de referencia del usuario, sin el sonido).

## Pendiente (en este orden)
1. Montar los pads menores y sostenidos cuando el usuario envíe los MP3 (ver `padEngine.ts` y `tools/make_pad_loops.py`). Probar los pads en el celular real.
2. Ideas: tonalidad de cada canción, secciones (Intro/Verso/Coro) en la forma de onda, sincronizar click con la canción, APK firmado de release.

## Sin verificar en dispositivo real
Sonido del click, salida solo-izquierda por una interfaz USB (AudioBox iTwo no fue reconocida por el celular en pruebas previas: tema aparte).

## Descarga de MEGA (oct 2026)
- DECISIÓN DEL DUEÑO: las canciones NO se guardan en el dispositivo (software comercial; evitar que extraigan los multitracks). Viven solo en memoria. No añadir cachés/descargas persistentes. main.tsx borra la BD vieja "crescendo-songs".
- MegaBrowser descarga con 16 conexiones y trozos de 1–8 MB (antes 4 conexiones, 128 KB–1 MB), con progreso (%, MB, MB/s).
- Optimización mayor: src/megaFast.ts descifra con WebCrypto (AES-CTR nativo) en vez del descifrado JS + verificación MAC de megajs (~16 MB/s vs ~450 MB/s medido en servidor). MegaBrowser baja con returnCiphertext y descifra después; si no hay crypto.subtle (p. ej. http en la red local) cae al método normal. ZIP: zipToFilesAsync (fflate con hilos y filtro de audio).

## Plan comercial (NO implementado; dueño pidió tenerlo en cuenta y avanzar poco a poco)
- Quiere vender con membresía mensual (cuenta activa para usar la app), ofuscar/encriptar parte del código y esconder el link de MEGA.
- Criterio de diseño: nada que el cliente pueda descargar debe depender de un secreto guardado dentro del APK. La protección real requiere servidor: login + suscripción vigente → el servidor entrega enlaces temporales/audio. No añadir cachés persistentes de canciones.
- Pasos tentativos: 1) decidir backend y pagos; 2) login/licencia; 3) servidor entrega canciones; 4) ofuscar el JS en el build; 5) quitar el link fijo de MEGA del código.

## Cambios revisados de otra cuenta de Claude (oct 2026)
- App.tsx: la pista de referencia para sincronizar es la más larga (antes la primera; si era corta, al terminar arrastraba las demás hacia atrás). Probado: pistas de 4/7/12 s siguen avanzando hasta los 12 s y luego se detiene todo.
- archive.ts: el RAR también ignora archivos ocultos / __MACOSX.
- AndroidManifest: allowBackup=false (que no se puedan sacar datos de la app por copia de seguridad).
- .gitignore: se ignoran los assets generados por `cap sync` (el workflow los regenera). OJO: la versión recibida había borrado node_modules/dist de la lista; se fusionó.

## Biblioteca rediseñada (oct 2026)
- Panel lateral izquierdo según el diseño del dueño (menu_diseno.rar) pero con el azul marino de la app (el azul claro del original se descartó). Origen "Nube Crescendo" en vez de "MEGA": ningún texto visible nombra a MEGA; los errores del servicio se traducen en friendlyError (MegaBrowser.tsx).
- MegaBrowser.tsx devuelve dos bloques (subbar de estado/ubicación + lista con scroll); App.tsx pone cabecera y selector. Tocar un ZIP/RAR lo selecciona y muestra "＋ AÑADIR" (evita descargas accidentales). Solo se listan carpetas y ZIP/RAR.
- En horizontal corto todo el panel hace scroll para dejar espacio a la lista.

## Extracción de ZIP/RAR optimizada (oct 2026)
- Antes (versión entregada con fflate `unzip` asíncrono): un ZIP de 153 MB con 10 pistas WAV tardaba ~14 s y llegaba a ~3,5 GB de RAM (descomprimía todas a la vez). Ahora (medido en Chromium headless con el mismo ZIP): ~2 s y ~0,6 GB; pistas idénticas (SHA-256).
- archive.ts: `zipToFilesAsync(Blob | Uint8Array)` lee solo el índice del ZIP (incluye ZIP64) y descomprime cada pista con `DecompressionStream('deflate-raw')` hacia un Blob; las pistas sin compresión se usan sin copiar. Con un archivo del dispositivo el ZIP no se carga entero en memoria. Respaldo: `zipToFilesFallback` (fflate, una pista a la vez) si el navegador no trae DecompressionStream.
- RAR sigue con libarchive.js (WASM); es más pesado (el archivo entero pasa por el WASM). Sin medir con un RAR grande (no hay forma de crear RAR aquí). Recomendación: guardar los multitracks de la biblioteca como ZIP.
- Se borró public/__song.zip (archivo de prueba de 2,4 MB que se estaba empaquetando en el APK).

## Fluidez de animaciones (oct 2026)
- Causa de lo "tosco": cada 150 ms se llamaba a setCurrentTime → toda la app se repintaba y la forma de onda se redibujaba entera (gradientes por barra). Medido simulando un celular (CPU 4× más lento, 8 pistas): ~22 fps en reposo con tareas de hasta 170 ms. Ahora ~58 fps y tareas máx. ~50 ms.
- Waveform.tsx: dibuja una sola vez dos capas (apagada/encendida); mientras suena solo mueve la variable CSS `--p` en cada requestAnimationFrame (clip-path de la capa encendida + transform de la línea). `getProgress` lee el audio en vivo; `progress` (estado) solo sirve en pausa/accesibilidad.
- App.tsx: el estado `currentTime` solo cambia al cambiar el segundo mostrado (o en pausa); `ChannelStrip` con memo para que mover un fader solo repinte ese canal; `pickLead` compartido.
- CSS: se quitó backdrop-filter del fondo de la biblioteca (caro en GPU móvil).
- MainActivity.java: pide a Android la mayor frecuencia de pantalla disponible (90/120 Hz) con la misma resolución. SIN PROBAR en un teléfono real (solo se compiló contra stubs); si falla la compilación en GitHub Actions, revisar este archivo primero.

## Descarga propia (megaFast.fastDownload)
Pide la URL una vez (`a:"g"`), baja trozos de 4 MB con 24 conexiones directo a un Uint8Array exacto, descifra cada trozo con WebCrypto al llegar (solapa descarga y descifrado), reintenta 4 veces; si falla cae al método anterior de megajs. Probado con servidor simulado (descarga idéntica con fallos forzados). Falta medir MB/s en el celular.
