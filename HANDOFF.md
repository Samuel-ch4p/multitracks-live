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

## Revisión general (oct 2026)
Hecho:
- Borrado `src/songCache.ts` (caché IndexedDB de canciones, sin uso pero contradecía la regla de no guardar nada en el dispositivo) y `src/__old_bench.ts` (código muerto). `main.tsx` conserva la limpieza de la BD vieja.
- `megaFast.ts`: cada trozo se pide con `cache: "no-store"` (nada queda en la caché HTTP del WebView) y con tiempo máximo de inactividad de 20 s (AbortController): antes una conexión colgada congelaba la descarga; ahora se aborta y el trozo se reintenta.
- `MegaBrowser.tsx`: guarda a nivel de módulo contra descargas simultáneas (el panel se desmonta al cerrarse y se podía lanzar una segunda descarga grande en paralelo → riesgo de quedarse sin RAM); mensaje claro cuando no hay memoria (RangeError).
- `App.tsx`: al quitar la última pista mientras suena, ya no queda "REPRODUCIENDO" con el botón bloqueado y la pantalla encendida; al quitar la última canción ya no queda pegado "Analizando forma de onda…".
- Borrado `capacitor.config.json` de la raíz: `capacitor.config.ts` tiene prioridad y el .json estaba desactualizado (otro color y sin edge-to-edge).
Pendiente / por decidir (ver informe): botón de cancelar descarga, memoria con ZIP >500 MB, nombres CP437 en ZIP, espera de `readyState` antes de reproducir, `src/assets/pads/` sin uso (3 MB), assets sin uso en `public/`.
NO probado: teléfono real, Gradle/APK, RAR (no hay forma de generarlos aquí), descarga real desde la nube.

## Pads sostenidos y menores (oct 2026)
- Añadidos 12 ciclos OGG de 32 s en `public/pads/`: Cs, Ds, Fs, Gs, As (♯) y Cm, Dm, Em, Fm, Gm, Am, Bm (menores), hechos de los MP3 del dueño (`tools/make_pad_loops_extra.mjs`, versión Node de make_pad_loops.py; usa ffmpeg). Registrados en `SAMPLES` de `padEngine.ts`; los botones ♯ y m ya están habilitados.
- No existen acordes sostenido+menor: al activar uno se apaga el otro (antes se apagaban ambos). E♯ y B♯ quedan deshabilitados (son F y C).
- Memoria: ahora hay 19 audios (~11 MB decodificado c/u). `preload()` solo carga el acorde elegido y la caché guarda máx. 4.
- Probado en navegador (vista previa de producción): los 12 OGG decodifican (32 s) y los botones cambian a C♯ y Bm. NO probado: el sonido real/empalme al oído en el teléfono.

## Correcciones táctiles (oct 2026, probado por el dueño en teléfono: pads OK)
- `Fader.tsx`: con el dedo, tocar ya no mueve el fader hasta que el gesto sea vertical (>8 px y más vertical que horizontal); un toque corto y quieto sí salta a esa altura. Así se desliza el mezclador de lado por encima de los faders sin cambiar volúmenes. Mouse: inmediato como antes. `Pan.tsx` sigue con el comportamiento anterior (touch-action: none, mueve al tocar).
- Menú "Cortar/Copiar/Pegar/Seleccionar todo": lo causaba `onFocus → select()` del campo BPM de `Click.tsx` (ahora al enfocar queda vacío con el BPM actual de marcador) y `user-select: text` en el panel de biblioteca y el cajón (quitado; solo los campos de texto lo conservan). `-webkit-touch-callout: none` en `.app`.
- SIN probar en teléfono real tras este cambio.

## Botones redundantes quitados (oct 2026)
- Quitado el botón MEZCLADOR de la barra "en vivo" (ya está la pestaña Mezcla abajo) y el botón grande CONECTAR / REINTENTAR CONEXIÓN del centro de la biblioteca (ya está el de arriba a la derecha).

## Forma de onda arrastrable (oct 2026)
- `Waveform.tsx`: ahora se puede deslizar. Al tocar/arrastrar, la línea sigue el dedo (sin mover el audio); al soltar se hace un solo `onSeek`. Un toque simple sigue funcionando (salta al soltar). Sin probar en teléfono ni con canción cargada (solo compilación/lint).

## Mezcla por canción (oct 2026)
- `App.tsx`: al cambiar de canción se guarda en memoria (`mixesRef`, por nombre de archivo de pista) volumen, paneo, mute y solo de la canción que se deja, y se restauran al volver a ella. Solo vive mientras la app está abierta (no se guarda en el dispositivo). Se borra al quitar la canción de la lista. Master sigue siendo global. Sin probar en teléfono.

## Arranque sin saltos (oct 2026)
- Color único `splash_bg` = #07162B (colors.xml; el mismo en `capacitor.config.ts` backgroundColor, `index.html` theme-color, windowBackground de los temas y `.splash` en App.css). `redline_bg` (#050C16) sigue para barras de estado/navegación.
- Tema de lanzamiento `AppTheme.NoActionBarLaunch` (hereda Theme.SplashScreen): ya no usa `drawable/splash.png`; fondo azul liso + icono `drawable/splash_transparent.xml` (vector vacío). `values-v31/styles.xml` (Android 12+) añade los atributos android:windowSplashScreen* y duración 0 (el sistema puede ignorar la duración).
- `Splash.tsx`/App.css: `.splash` es azul liso #07162b y el degradado radial entra con fundido en `::before` (antes todo el splash nacía en opacidad 0 y dejaba ver el degradado de la app). `#root:empty` (index.css) pinta el mismo azul antes de que React monte.
- `@capacitor/splash-screen` NO está instalado ni se añadió. Los `splash.png` de res/drawable-* quedaron sin uso (se pueden borrar; `npm run assets` los regenera).
- NO verificado: apariencia en teléfono real (Android 12+ y 11-) ni compilación de Gradle/aapt2.

## Normalización, paneo y pads sostenidos (oct 2026)
Archivos nuevos: `src/analysis.ts` (medición y plan de normalización), `src/panLaw.ts` (ley de paneo), `src/trackGraph.ts` (cadena de audio de cada pista), `tools/verify-normalize.ts` (`npm run verify`).

### 1) Normalización de volúmenes
- Causa: las pistas sonaban tal cual venían del archivo; no había ninguna medición de nivel.
- Qué hace ahora: al cargar la canción, la misma pasada que dibuja la forma de onda (`computePeaks`, ahora a 22,05 kHz) mide cada pista por bloques de ~1 M de muestras cediendo el hilo entre bloques (no congela la pantalla). Potencia media con compuerta (bloques de 0,4 s; se ignoran los de menos de -50 dB y los 20 dB por debajo del promedio) y pico.
- Ganancia en un nodo `norm` APARTE del fader: los faders siguen en 80 y se mueven normal.
- Objetivos: instrumentos -18 dBFS de potencia media por pista (típico de una mezcla sana: deja margen para sumar y que los picos no lleguen a 0); Guía -20 dB (2 dB abajo, que se oiga sin tapar); Click por pico a -6 dBFS (suena en ráfagas, el RMS no sirve). Subida máx. +12 dB, bajada máx. -30 dB, techo -1 dBFS de pico por pista (en estéreo con 3 dB extra para el paneo extremo).
- Seguridad de la suma: potencia estimada de la mezcla ≤ -14 dB y pico estimado ≤ -1 dBFS (picos sumados en cuadratura, -3 dB por no coincidir). Si pasa, TODAS las pistas bajan por igual (14 pistas ≈ -7,5 dB; 2 pistas, nada).
- Click/Guía se reconocen por el nombre (click, clic, metrónomo, guía, guide, cue). Interruptor "NORM" en la tira MASTER del mezclador (activo por defecto, se recuerda en localStorage `crescendo-normalize-v1`).
- Al pulsar play, si el análisis de la canción no ha terminado se espera (máx. 15 s, "Analizando niveles…"); la forma de onda y las medidas quedan en memoria por canción (volver a una canción es instantáneo).
- Límite: a 22 kHz el pico medido puede quedar un poco bajo el real en sonidos muy agudos. Pistas de más de 150 MB no se miden (ganancia 1, paneo estéreo).

### 2) Guía que no obedecía el paneo
- Causa probable (no se tienen tus 2 archivos; el código no trata "Guía" de forma especial): todas las pistas pasaban por el mismo `StereoPannerNode`, pero una Guía exportada como ESTÉREO con el audio en un solo canal (L o R) quedaba fija en ese lado con el paneo al centro y el control "no hacía caso".
- Ahora cada pista entra siempre como 2 canales y se clasifica al medirla: mono, solo-L, solo-R o estéreo. Mono / solo-L / solo-R usan UN canal con paneo normal (la Guía solo-R con paneo a la izquierda suena solo a la izquierda). El paneo se reaplica con cada cambio y con cada medición (`applyMix`), también al cambiar de canción.
- Todas las pistas usan `buildTrackGraph` (fuente → entrada 2 canales → separador → 4 ganancias de paneo → unión → norm → fader → master); ninguna se salta el paneo.

### 3) Volumen que baja al panear
- Causa: `StereoPannerNode` con estéreo SUMA los dos canales hacia un lado: con L=R sube +3 dB al extremo, y con contenido amplio/en contrafase se pierde nivel; con una sola pista mono dependía de cómo se sumara en el altavoz.
- Ley elegida (`panLaw.ts`): potencia constante, seno/coseno. Mono-like: gL = cos θ, gR = sin θ (centro 0,707 por lado = igual que antes). Estéreo: balance con compensación √2·cos θ sobre L y √2·sin θ sobre R (centro = pasa igual que antes; los lados no se mezclan entre sí).
- Medido con render fuera de línea del grafo real (Chromium): variación de la energía total de -1 a +1: mono 0,00 dB, estéreo real 0,03 dB, solo-L / solo-R 0,00 dB, estéreo con L=R 0,00 dB (antes 3,01 dB). Centros idénticos a los de antes en mono, estéreo real y solo-L/R (en estéreo L=R sigue igual que antes).
- Ojo: con un altavoz único o dos altavoces muy juntos (suma coherente) el centro se oye ~3 dB más fuerte que un extremo; es la propiedad de cualquier ley de potencia constante.

### 4) Pads sostenidos
- Se probaron en Chromium los 28 acordes (7 notas × mayor/♯/m/♯m) con el motor real: todos reproducen y tienen señal. Los 12 OGG nuevos existen y decodifican; los nombres de la tabla coinciden con los archivos. No se encontró un fallo en el motor para C♯ D♯ F♯ G♯ A♯.
- Fallos reales encontrados (posible explicación de lo visto en el celular): (a) E♯ y B♯ estaban deshabilitados y con ♯ activo y la nota E o B, pulsar ♯ no hacía nada; (b) ♯ + menor apagaba los dos; (c) al expulsar audios de la caché la promesa vieja seguía reteniendo el audio.
- Arreglado: E♯→F, B♯→C (se muestran como E♯/B♯); sostenido+menor (C♯m, D♯m, F♯m, G♯m, A♯m) ahora existe y se obtiene tocando el menor de la nota de abajo un semitono más agudo (`playbackRate` 2^(1/12)); si pasas audios reales, cambia la entrada en `SAMPLES` por `{ file: "Csm.ogg" }`. La caché de audios es por archivo (máx. 4).
- Si en el celular algún sostenido sigue sin sonar: indica cuál nota y si estaba el ♯ o m activo; no se pudo confirmar con el dispositivo.

### Cómo probar en el celular
1. Canción con pistas muy dispares: tocar play; apagar/encender NORM (tira MASTER, al fondo del mezclador): debe cambiar el balance entre pistas y los faders no se mueven. Click y Guía deben oírse, sin tapar.
2. Guía de las 2 canciones problemáticas: mover su paneo de lado a lado; debe oírse moverse (con paneo al centro suena por ambos lados).
3. Mover el paneo de una pista mono y de una estéreo: el volumen debe sentirse parejo.
4. Pads: probar ♯ con C D F G A, E♯/B♯ (suenan como F y C), m, y ♯+m (suena un semitono arriba).
- Verificado por pruebas: `npm run verify` (clasificación mono/L/R/estéreo, nombres Click/Guía, tope +12 dB, techo -1 dBFS, suma ≤ -14 dB, paneo ±1 dB, centro igual que antes), render fuera de línea del grafo real, reproducción de 28 acordes, reproducción de 4 pistas de prueba en la app (ganancias norm/paneo leídas del grafo real; NORM apaga y se recuerda). No verificado: oído real, teléfono, mezcla de canciones reales, compilación Gradle.

## Diseño nuevo de Figma aplicado (oct 2026)
Referencia: `new diseno.rar` (export de Figma Make: src.zip con App.tsx e index.css; la parte más reciente del CSS manda). Se reconstruyó sobre el código real SIN tocar audio, descarga ni pads. Adaptación principal: el fondo del diseño era casi negro-grafito; se mantuvo AZUL MARINO (#07162B) como pediste y de Figma se tomó el sistema plateado, vidrio, colores por familia y animaciones.

### Archivos
- `src/theme.css` (NUEVO): TODAS las variables: fondos navy (`--c-bg-*`), plateados (`--c-silver-*`), texto/líneas/cristal, estados, familias (`--fam-*` + `-rgb`), neón de pads (`--pad-neon`), radios `--r-*`, espacios `--sp-*`, sombras `--sh-*`, movimiento. `--c-bg-1` (#07162B) es el MISMO color de Android (`colors.xml` → `splash_bg`), `capacitor.config.ts` e `index.html`.
- `src/skin.css` (NUEVO): el aspecto de cada componente (App.css conserva la disposición). Las animaciones costosas llevan el comentario `[PESADO]` o `[PESADO-LIGERO]`.
- `src/trackFamilies.ts` (NUEVO): mapa de nombres de pista → familia (listas `KEYWORDS`, edítalas ahí). Rojo ritmo #FF3B4E (batería, percusión, loops, kick, snare…), azul eléctrico #2F6BFF armonía (guitarras, bajo, teclas, pads, piano, synth…), morado #9B5CFF guía y click (guia, guide, cue, click, metrónomo…), rosado #FF4FA3 voces (voz, vox, coros, bgv…); sin reconocer = plateado #D3D7DC. Prioridad: guía/click → voces → ritmo → armonía. Sin tildes ni mayúsculas. Prueba: `npm run verify` (42 nombres).
- `src/BrandMark.tsx` (NUEVO): logo "C" de anillos en vectores (nítido a cualquier tamaño, sin recuadro). Se usa en cabecera, splash y tarjeta de carga. Se borraron `assets/logo.png` y `emblem.png` (ya no se usan).
- `src/meters.ts` (NUEVO): medidores vivos. Un solo requestAnimationFrame; lee un AnalyserNode por canal y mueve el relleno con `transform` directo en el DOM (cero re-renders de React). Se detiene solo cuando no hay señal.
- `src/effects.ts` (NUEVO): ajuste "Efectos visuales: Completos / Reducidos".
- `src/trackGraph.ts`: ÚNICO cambio de audio: se añadió un `AnalyserNode` que cuelga del fader solo para observar el nivel (no se oye ni cambia la señal). `App.tsx` también crea un analizador en el master. Todo lo demás del audio (normalización, paneo, pads) intacto.
- `Fader.tsx`, `Waveform.tsx`, `App.tsx`, `Splash.tsx`, `MegaBrowser.tsx`, `main.tsx`, `index.html`, `index.css`, `App.css`: cambios de presentación (colores plateados, medidor LED, punto de color, solo/mute, inercia del fader, cabezal con estela, tarjeta de carga con progreso, entrada escalonada de la lista, splash).
- Android: `res/drawable/splash_icon.xml` (la "C" en vectores, lienzo 288 dp, sin fondo ni recuadro), `values/styles.xml` y `values-v31/styles.xml` (fondo `splash_bg`, icono `splash_icon`, duración 0), se quitó `splash_transparent.xml`.

### Dónde se activan/desactivan los efectos
- Botón de destellos (✦) arriba a la derecha de la cabecera: alterna Completos ⇄ Reducidos y lo recuerda (`localStorage` `crescendo-fx-v1`). Aplica `<html data-fx="full|reduced">`. Valor por defecto: Completos.
- Reducidos apaga: desenfoques de fondo (cabecera, panel de biblioteca, tarjeta de carga), atmósfera y partículas del splash, brillo difuso de los faders, estela del cabezal, aura de la tarjeta de carga, resplandor de pads, brillo de señal en los canales (`--sig`), y baja los medidores de ≈40 a ≈20 fps.
- `prefers-reduced-motion` del sistema apaga todas las animaciones (CSS) sin tocar el ajuste.

### Animaciones que considero pesadas (para simplificar si el celular sufre)
1. `backdrop-filter` de cabecera, scrim de biblioteca y tarjeta de carga (desenfoque del fondo): la más costosa en GPU media.
2. Splash: atmósfera (`filter: blur(100px)` sobre 380 px) y 14 partículas.
3. Brillo difuso de faders (`.fader-glow`, blur 7 px × 8–16 canales, anima solo opacidad).
4. Medidores LED + `--sig` en cada canal (JS por fotograma; con 16 canales ≈ 40 fps). Si hace falta: bajar a 20 fps en `meters.ts` (`minGap`).
5. Aura giratoria de la tarjeta de carga (`conic-gradient` rotando).
6. Resplandor pulsante de pad activo (`pad-afterglow`, solo opacidad) y trazo de luz con `drop-shadow` en los anillos del splash.
7. Transición entre pestañas con perspectiva (solo transform/opacidad; barata, pero repinta la pantalla entera).
Todo lo demás (botones, fader con inercia, pulso de pads) usa solo transform/opacidad.

### Arranque continuo (Android + app)
Sistema (Android 12+: `values-v31`; ≤11: tema compatible de androidx) → fondo #07162B + "C" de anillos centrada (anillos de ~190 dp) → en cuanto carga el HTML, `#boot` de `index.html` muestra el MISMO logo (242 px, centro) → `Splash.tsx` empieza con el logo en el mismo sitio y los anillos "se encienden" con un trazo de luz; `main.tsx` quita `#boot` tras el primer pintado. Sin destello blanco: html/body/WebView/ventana son #07162B.

### Cómo probar en el celular
1. Compilar APK, abrir: ¿el arranque del sistema es azul marino con la "C" nítida, sin recuadro ni borroso, y pasa al splash animado sin parpadeo?
2. Horizontal y vertical: botones de play/stop grandes, M/S (38 px), faders con perilla plateada, relleno de color por familia, línea de color arriba de cada canal, medidor LED que se mueve al sonar.
3. Solo (S): ese canal brilla y los demás bajan; Mute (M): canal desaturado.
4. Pads: borde morado, pad activo con degradado y brillo, pulso al tocar. Click y biblioteca: plateado, sin celestes.
5. Biblioteca → Nube Crescendo → CONECTAR → elegir un ZIP → AÑADIR: lista con entrada escalonada y tarjeta de progreso (porcentaje real, velocidad, "pista X de Y").
6. Botón ✦: pasar a Reducidos y comprobar que baja el consumo/mejoran los fps.
- NO verificado aquí: apariencia real en teléfono (probé en Chromium con ventanas de 844×390, 390×800 y 1280×760), notch/zonas seguras reales, compilación de Gradle/aapt2 de los recursos Android nuevos, tarjeta de carga con una descarga real (no hay red a la nube aquí).

### Piezas añadidas del diseño (oct 2026, 2.ª pasada)
- `src/skin-player.css` (NUEVO, se carga tras skin.css) + `src/ScrubBar.tsx` (NUEVO).
- Indicador deslizante de la barra de pestañas (`.tab-bar::before`, usa `--tab-i`; horizontal en vertical/PC, vertical en el riel del celular horizontal). Solo transform.
- Mini-reproductor (pestañas Biblioteca y Mezcla, con canción cargada): nombre, estado, barras vivas y play/pausa; tocarlo abre el reproductor ampliado. En celular horizontal bajo se oculta (la cabecera ya trae el transporte).
- Reproductor ampliado (`.player-overlay`): arte grande, nombre, nº de pistas, barra de progreso ARRASTRABLE (salta una sola vez al soltar), anterior/play/siguiente y "Abrir mezclador". Se abre desde el mini-reproductor o tocando "Canción cargada" en Live. Dos columnas en horizontal.
- Tarjeta Master en la pestaña Mezcla: nivel en dB del master (20·log10 del fader; 85 % = −1,4 dB) y medidor LED horizontal de la salida (`meters.ts` ahora admite eje X; clave "master-card").
- NO añadido por falta de datos (esperan tu respuesta): artista, tonalidad y secciones (Intro/Verso/Coro). Ver propuestas abajo. Tampoco la pestaña Mezcla como lista distinta de las tiras (el diseño usa las mismas tarjetas).
- Probado en Chromium (390×800, 844×390): mini-reproductor, ampliado, tarjeta Master con dB y LED, pastilla de pestañas. No probado en celular.

### Datos pendientes de decidir (no inventados)
- Artista: ninguno de los archivos lo trae. Propuesta: tomarlo del NOMBRE DE LA CARPETA de la nube (ej. "MercyMe/Almost There/…zip" → MercyMe; ya se conoce `path` en MegaBrowser) y, en canciones locales, del patrón "Artista - Canción" del nombre del archivo si existe.
- Tonalidad: tampoco viene en los archivos. Opciones: (a) campo que tú tocas para elegirla por canción (se guarda solo en memoria, o en un nombre de archivo "Canción (Tono A).zip" que la app lea), (b) leerla del nombre del ZIP si sigue un patrón, (c) detectarla automáticamente (poco fiable con pistas separadas).
- Secciones: no hay datos. Opciones: marcadores dentro del ZIP (un `markers.json` o `.txt` con tiempo+nombre), o ponerlos a mano en la app durante la sesión (sin guardar).

## Click ligado a la canción
Probado y revertido por decisión del usuario.

## Paneo inicial de Click y Guía (oct 2026)
- `trackFamilies.ts` → `defaultPan(name)`: las pistas de la familia "Guía y Click" (la misma lista `guide`, sin distinguir mayúsculas/tildes) arrancan en paneo -1 (100 % izquierda); el resto en 0. `App.tsx` lo usa en `createTrack`, así que la perilla y el audio (`applyMix` → `applyPan`) coinciden desde que se carga la canción. Es solo el valor inicial: si el usuario lo mueve, se respeta (y la mezcla por canción en memoria lo recuerda). Para cambiar qué pistas van a la izquierda, editar la lista `guide` de `trackFamilies.ts`.
- `panLaw.ts`, pistas ESTÉREO: antes, a paneo total el canal contrario se descartaba (√2·L, R perdido). Ahora el contrario se dobla hacia el lado elegido (a 100 % sale 0,707·(L+R) por un lado). Con lados parecidos el volumen es igual al del centro (±0,5 dB en la prueba); con lados totalmente distintos baja ~3 dB (inherente a sumar). Esto afecta también al paneo manual de pistas estéreo. Mono / un solo lado: sin cambios (a la izquierda: todo por L con nivel 1 = misma energía que 0,707 por lado).
- Pruebas: `tools/verify-pan-default.ts` (Click/Guía en -1, resto en 0) y casos nuevos en `tools/verify-normalize.ts`; ambas dentro de `npm run verify`. Verificado en navegador: al cargar Bajo/Click/Guía/Pad, las perillas marcan 0 / -100 / -100 / 0. SIN comprobar al oído en el celular.
