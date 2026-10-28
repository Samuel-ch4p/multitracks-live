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

## Multitracks pesados: se demoraba / se cerraba (oct 2026)
- Medido con dos multitracks reales del dueño. ZIP "Algo Nuevo Empezó" = 29 pistas FLAC (356 MB): extracción 1,3 s, pero el análisis de nivel decodifica cada FLAC completo (21 s en PC; mucho más en el celular) y `playAll` esperaba hasta 15 s a que terminara. RAR "Cerca De Mí" = 634 MB que descomprimidos son 1,8 GB (10 WAV de 170 MB + un MP3 de la mezcla + un WAV de pads): en PC tarda 12 s y las dos últimas pistas ya salen ILEGIBLES (`NotReadableError`: se agotó el espacio de Blobs); en el celular es peor (WASM + memoria).
- `wavAnalysis.ts` (nuevo): los WAV se analizan leyéndolos por tandas de 4 MB, sin decodificar y sin límite de tamaño (antes los de más de 150 MB se saltaban y la canción se quedaba sin forma de onda ni normalización). Usa `StatsAccumulator` (analysis.ts), el mismo cálculo que `measureBuffer` (comprobado en `tools/verify-wav.ts`: mismo layout/pico/potencia). 10 WAV de 170 MB: 9 s en PC, pantalla sin congelarse más de ~70 ms.
- `App.tsx`: Play espera máx. 4 s al análisis (antes 15 s); si no alcanza, empieza igual y el nivel se ajusta al terminar de medir.
- `archive.ts`: un RAR que ya descomprimido pase de 900 MB se rechaza con un mensaje claro ("conviértelo a ZIP sin compresión") en vez de colgarse. RECOMENDACIÓN: guardar los multitracks como ZIP SIN compresión (store): se usan por tramos del archivo original, sin copiar (el ZIP de 1,7 GB de Cerca de Mí: extracción 7 ms, 10 pistas legibles).
- NO resuelto/confirmado: el cierre de la app con el ZIP de 29 FLAC. En PC no se reproduce (heap JS 91 MB). Sospechas: memoria nativa de decodificar 29 FLAC en el análisis y 29 `<audio>` FLAC a la vez en Android. Si sigue cerrándose: `adb logcat` / chrome://inspect en el momento del cierre.

## Optimización para multitracks grandes (oct 2026, 2.ª vuelta)
- Síntoma en el celular: con muchas pistas (29 FLAC) suena lento y entrecortado, o se cierra. Causas probables y cambios (SIN medir en el teléfono; en PC solo se comprobó que todo suena y los medidores se mueven):
  - `App.tsx`: el AudioContext de las pistas usa `latencyHint: "playback"` (buffers de salida mayores = menos cortes). La corrección de desfase entre pistas ahora espera si alguna pista está cargando/buscando y su umbral subió de 80 a 120 ms (corregir en pleno tartamudeo empeoraba los cortes).
  - `archive.ts` `computePeaks(files, buckets, isCancelled, shouldWait, …)`: el análisis (decodificar/leer cada pista) se PAUSA mientras suena la canción (antes competía con el audio por CPU y memoria, sobre todo con FLAC). Efecto: en canciones pesadas la normalización y la forma de onda terminan cuando se detiene/pausa; los WAV casi siempre terminan antes de pulsar Play.
  - `trackGraph.ts`: pista estéreo en el centro = matriz de paneo identidad → se salta (entrada → normalización directo) y el separador, 4 ganancias y unión dejan de procesarse (de ~11 a ~5 nodos por pista). Al mover el paneo vuelve la cadena completa (comprobado: audio sigue al mover y regresar).
- Pendiente si sigue mal: leer los FLAC a un formato más liviano al cargar, reducir medidores por pista cuando hay >16, o `adb logcat` para ver el motivo exacto del cierre.

## Nube Crescendo sobre Google Drive + Play rápido + normalización nueva + buscador + perfiles (oct 2026)
Archivos nuevos: `cloudConfig.ts`, `driveSource.ts`, `NubeBrowser.tsx`, `searchIndex.ts`, `songTags.ts`, `normConfig.ts`, `normalizer.ts`, `trackProfiles.ts`, `ProfileDrawer.tsx`, `perf.ts`, `.env.example`, pruebas `tools/verify-{drive,search,profiles}.ts` (todas dentro de `npm run verify`). La fuente anterior (`MegaBrowser.tsx`) sigue ahí como respaldo.

### 0) Drive como fuente de la Nube
- Configuración: `.env` (NO se sube; ver `.env.example`) con `VITE_DRIVE_API_KEY` (llave de Google restringida a "Google Drive API") y `VITE_DRIVE_ROOT_ID` (carpeta raíz compartida: "Cualquier persona con el enlace · Lector"). Estructura: Raíz/<Artista>/<Canción>.zip.
- GitHub Actions: crear dos secrets del repositorio (Settings › Secrets and variables › Actions › New repository secret): `VITE_DRIVE_API_KEY` y `VITE_DRIVE_ROOT_ID`. `android.yml` los pasa como variables de entorno al `npm run build`. Sin ellos la app compila, pero la Nube muestra "aún no está configurada". OJO: la llave queda dentro del JS del APK (como el enlace anterior): restringirla SOLO a Drive API y, si se puede, a la app/origen (en Android el origen es `https://localhost`; si se pone restricción por referente, incluir `https://localhost/*`).
- Respaldo: `VITE_CLOUD_SOURCE=mega` en `.env` (o `DEFAULT_SOURCE` en `cloudConfig.ts`) vuelve a la fuente anterior.
- `driveSource.ts`: `listChildren` (q = carpeta padre y `trashed=false`, `fields=nextPageToken,files(id,name,mimeType,size,modifiedTime)`, `pageSize=1000`, paginación completa), `listArtists` (SOLO carpetas; ignora .rar/.zip sueltos de la raíz), `listSongs` (SOLO .zip), orden sin mayúsculas/acentos; NO fusiona ni renombra variantes ("Bethel"/"Bethel MUSIC"…). `downloadFile`: `files/{id}?alt=media&key=…` con Range, trozos de 4 MB, 8 conexiones (Drive limita por usuario), reintentos con espera creciente, parada tras 20 s sin datos, progreso real; cada trozo es parte de un Blob (sin bloque gigante ni copia final) y el ZIP se lee por tramos (`zipToFilesAsync(Blob)`). Si el servidor no admite Range cae a descarga continua. 403 de cuota / 429 / 5xx se reintentan; 404 y otros 403 no. Mensaje al usuario: "No se pudo descargar ahora, intenta en unos minutos." (nunca nombra el servicio).
- Hallazgo: el progreso del `LoadCard` de `MegaBrowser.tsx` nunca mostraba porcentaje (las expresiones regulares no tenían `\d`); corregido y reutilizado por `NubeBrowser`.
- NO verificado contra el Drive real (no hay `.env` aquí): se probó con un Drive simulado (paginación de 2 424 elementos, filtrado, Range, cuota, 404, sin Range). Pendiente en el celular/real: que Drive acepte la petición con cabecera `Range` desde el WebView (si el navegador bloqueara el preflight CORS el código solo cae a descarga continua cuando recibe 200; si falla de red, muestra el mensaje amable) y la cuota diaria de la llave.
- FLAC en Android: el celular ya decodificó y reprodujo un ZIP de FLAC (29 pistas) en pruebas anteriores; no se puede reconfirmar desde aquí.

### 1) Retraso de ~15 s al dar Play
- CAUSA RAÍZ: al pulsar Play, `playAll` esperaba el análisis de niveles (decodificar CADA pista completa, de a una) con un tope de 15 s, y después reiniciaba cada pista a 0, creaba los nodos y recién entonces llamaba a `play()`. En un celular la decodificación de 12-15 FLAC dura más que ese tope, así que Play tardaba justo 15 s.
- Ahora todo ocurre al CARGAR la canción (`prepareTracks` en `App.tsx`): se crea el grafo de audio de cada pista, se espera a que cada `<audio>` tenga datos para sonar sin cortes (`readyState ≥ 3`) y se mide nivel/tipo de cada pista (2 a la vez, `computePeaks` con `concurrency`). Estado visible "Preparando pistas… 8/13" (píldora superior + barra con botón TOCAR YA). Si se pulsa Play antes, queda en espera visible y arranca solo al terminar; TOCAR YA fuerza el arranque sin esperar (sin normalizar).
- Al pulsar Play: `resume()` solo si el contexto no está activo, se reinician únicamente las pistas que no están en 0, y los `play()` de todas se lanzan en la misma vuelta del programa (el corrector de desfase mantiene la alineación). Tras Detener las pistas vuelven a quedar listas.
- No se pasó a `AudioBufferSourceNode`/`start(when)`: decodificar todas las pistas completas ocuparía ~100 MB por pista de 5 min en estéreo (13 pistas ≈ 1,4 GB) y no cabe en un celular. Se mantiene `<audio>` + `MediaElementSource`.
- Un solo AudioContext por sesión (`getContext`), despertado con el primer gesto (`pointerdown`/`keydown` en captura) y de nuevo si el sistema lo suspende.
- Memoria: `statsRef` ahora es `WeakMap` (antes retenía los archivos de canciones quitadas); presupuesto de memoria para canciones descargadas (`memoryBudget()`: 20 % de `navigator.deviceMemory`, entre 0,6 y 1,5 GB): al añadir otra se quitan del repertorio las más antiguas que no suenan (también la activa si está parada). Motivo medido: con 335 MB + 1,7 GB de Blobs en la página, Chromium dejó ilegibles los archivos (`NotReadableError`) y la canción grande quedó sin forma de onda. Con el presupuesto la canción grande carga y se analiza normal.
- Tiempos medidos en PC (Chromium, 13 pistas FLAC estéreo de 4,5 min, 335 MB, Drive simulado local; el celular será 5-10 veces más lento en decodificar):

| Etapa | Antes | Ahora |
|---|---|---|
| Descarga 335 MB (localhost) + extracción ZIP | 1,5 s | 1,5 s |
| Decodificar + medir cada pista | 0,65 s (8,4 s las 13, en serie) | 0,65 s c/u, de a 2: listas en 5,3 s con progreso n/13 |
| Crear nodos de audio | dentro de Play | 3 ms, al cargar |
| `AudioContext.resume()` | 40 ms, en Play | 0 ms (ya activo) |
| Espera del análisis dentro de Play | hasta el resto de 8,4 s (tope 15 s) | 0 (ya terminó) |
| Reiniciar pistas a 0 (seek) | 184 ms | 12 ms (solo las que no están en 0) |
| Esperar pistas en 0 | 50 ms | 0 |
| `play()` de todas | 1 ms | 5 ms |
| TOTAL desde pulsar Play | 1,36 s medido con el análisis casi listo; ~8 s en el peor caso en PC; 15 s en el celular (el tope) | 17 ms |

  Canción de 10 WAV (1,7 GB, ZIP sin compresión): descarga y extracción 29 s en PC (disco local), preparación 0,8 s tras elegirla, pico de heap de JS 205 MB (los Blobs no cuentan ahí).

### 2) Normalización rehecha
- QUÉ ESTABA MAL: (a) nivelaba pista por pista al mismo nivel (-18 dB de potencia) y destruía el balance de la mezcla original (bombo = platillo = pad); (b) subía hasta +12 dB las pistas flojas, incluidas casi vacías (el ruido de fondo se hacía audible); (c) cambiaba Click (a -6 dBFS de pico) y Guía (a -20 dB) en vez de dejarlas; (d) el plan se recalculaba cada vez que llegaba la medición de una pista, también con la canción sonando (cambios de volumen a media canción / bombeo); (e) el tope de mezcla era una reducción global que dependía de qué pistas ya estuvieran medidas.
- AHORA (`normConfig.ts` = todos los umbrales con comentarios; `normalizer.ts` = plan puro): UNA sola ganancia por canción = referencia (-16 dBFS RMS por canal) menos el nivel de la mezcla de las pistas musicales (potencias sumadas ventana a ventana de 0,4 s, con compuerta de silencio absoluta -50 dB y relativa -20 dB), limitada a ±6 dB y a lo que permita el techo de pico (estimación -1 dBFS). Se aplica en el nodo `norm` de cada pista musical (etapa propia, separada del fader). Click y Guía (familia "Guía y Click" de `trackFamilies.ts`, `isGuideOrClick`) quedan fuera: ganancia exactamente 1, y van directo al master (no pasan por el limitador). Las musicales pasan por un bus con limitador suave (WaveShaper: idéntico hasta -3 dBFS, tanh hasta -1,3 dBFS; medido en Chromium: por debajo de -1,1 dBFS hasta +10 dB de sobrecarga; con entradas absurdas de +26 dB sobrepasa ~0,3 dB).
- Modos (botón NORM del master, alterna en vivo; se guarda en `crescendo-norm-mode-v2`; migra el interruptor anterior): Apagado / Suave (por defecto) / Nivelar pistas (Suave + corrige ±6 dB solo las pistas a más de 9 dB de la mediana; no sube las que están bajo -55 dB).
- El plan se calcula solo cuando TODAS las pistas musicales están medidas (si no, ganancia 1) y queda fijo mientras suena; solo cambia si se cambia el modo (rampa de 0,12 s).
- Click/Guía siguen midiéndose solo para saber si son mono o de un lado (necesario para el paneo), no para nivel.

### 3) Buscador de la Nube
- Campo fijo arriba de la biblioteca. Busca en vivo (retardo 200 ms), sin mayúsculas/acentos, guiones/puntos/guiones bajos = espacio, todas las palabras deben coincidir, en artistas y canciones ("Artista Canción" se busca junto). Resultados agrupados ARTISTAS / CANCIONES; tocar un artista abre su carpeta; tocar una canción la SELECCIONA y muestra "＋ AÑADIR" (así no se inician descargas grandes por error; poner `SEARCH_TAP_LOADS = true` en `NubeBrowser.tsx` para que baje al tocar).
- Índice (`searchIndex.ts`): solo metadatos (id, nombre, artista, tamaño). Se construye en segundo plano la primera vez (una consulta por artista, 6 a la vez, progreso "Indexando biblioteca… n/N"), se guarda en IndexedDB (`crescendo-meta` › `kv` › `nube-index-v1`, con fecha y `rootId`) y el botón "ACTUALIZAR ÍNDICE" lo reconstruye. Si IndexedDB falla queda en memoria. Mientras se indexa, los artistas ya se buscan con la lista cargada. Estados: indexando, sin resultados, error (REINTENTAR). `--kb` (visualViewport) reserva la altura del teclado al final de la lista.
- Etiquetas de tono/BPM (`songTags.ts`): "…-D-145bpm", "Ab 130,00 bpm", "Bb 105", "C#m - 72 BPM", "Canción - Em"; una "A" suelta en medio del nombre NO es tono; si no se puede extraer, no se muestra nada.

### 4) Perfiles de pistas
- Botón PERFIL (pestaña Mezcla y barra de la pestaña Live) abre el cajón: GUARDAR COMO PREDETERMINADO, GUARDAR SOLO PARA ESTA CANCIÓN, RESTABLECER VALORES DE FÁBRICA (pide un segundo toque), EXPORTAR / IMPORTAR (texto JSON visible y copiado al portapapeles; archivo o texto pegado). Indicador del perfil activo en el cajón, en la pestaña Mezcla y en la barra Live ("CANCIÓN CARGADA · PERFIL …").
- Guarda por tipo de pista (nombre sin el prefijo común, sin acentos ni número final: "Keys 1" y "Keys 2" = "keys"; si hay varias del mismo tipo manda la primera): volumen de fader, paneo, mute, solo y la familia; más el master. Por canción: por nombre de archivo exacto, con clave nº de pistas + hash de `nombre|tamaño` (`crescendo-profile-song-v1:<clave>`); general en `crescendo-profile-general-v1`. localStorage envuelto en try/catch.
- Prioridad al cargar: lo movido en esta sesión › esta canción › predeterminado › fábrica (fader 80, centro, Click y Guía a la izquierda; master 85, que solo se toca si algún perfil lo trae). Se aplica antes de que se pueda dar Play, así que no hay saltos. No incluye la ganancia de normalización.
- Guardar predeterminado fusiona (conserva los tipos de pista que no están en la canción actual). Restablecer borra el predeterminado Y el de la canción actual.

### Qué quedó verificado y qué no
- Por pruebas automáticas (`npm run verify`): paginación, filtrado, orden, Range y errores de Drive (simulado), búsqueda (acentos, varias palabras, concurrencia 6, fallos, sin IndexedDB), etiquetas, normalización (Click/Guía exactamente 0 dB, balance conservado, ±6 dB, techo de pico, silencios, modos, datos incompletos), limitador (en Node y renderizado real en Chromium), perfiles (prioridad, validación, almacenamiento, exportar/importar), WAV directo, paneo.
- En Chromium contra un Drive simulado: listado de artistas, descarga con Range y extracción de 335 MB y de 1,7 GB, búsqueda con IndexedDB, progreso "Preparando pistas… n/13", Play de 17 ms, ganancias reales (música +3,5 dB igual para todas, Click/Guía 0,00 dB), modo NORM rotando, perfiles guardados, aplicados y restablecidos tras recargar.
- SOLO en el celular: Drive real (llave, cuota, preflight de `Range`), tiempos reales de decodificación y preparación en el teléfono, que el audio no se entrecorte con 13-29 pistas, el teclado sobre el buscador, el sonido real de la normalización y del limitador, memoria con canciones grandes.

---

# Rediseño visual (rama `rediseno`)

La maqueta de Figma Make (`diseno/rediseno/`, no versionada; ver `.gitignore`) es **solo referencia visual**. La app real ya tenía casi toda la estructura de esa maqueta (pestañas, mezclador con medidores por refs, mini reproductor, tarjeta de carga), así que el trabajo fue llevar sus tokens y detalles, y añadir lo que faltaba. Sin Tailwind: todo es CSS normal.

## Mapa maqueta → componentes reales
| Maqueta | App real |
|---|---|
| `SplashScreen` | `Splash.tsx` + `BrandMark.tsx` (vectorial, sin recuadro) + arranque nativo (`values-v31`, `splash_icon.xml`, fondo `#07162B`) |
| `app-header`, `tempo-block`, `PlayButton` | `.topbar` en `App.tsx`; reloj en `clock.tsx` (`HeaderClock`) |
| `song-deck`, `deck-card` | `songDeck` en `App.tsx` |
| `waveform-panel`, marcadores | `Waveform.tsx` + `markers.ts` + `MarkerEditor.tsx` (marcadores nuevos) |
| `channel`, `master-column`, `master-card` | `ChannelStrip`, `MasterStrip`, `MasterCard`, `Fader.tsx`, `Pan.tsx`, `meters.ts` |
| `mini-player` | bloque `.mini-player` en `App.tsx` (`skin-player.css`) |
| `LibraryPanel` | `NubeBrowser.tsx`, `MegaBrowser.tsx` (respaldo), `LocalImport.tsx` |
| `load-card` | `LoadCard` en `MegaBrowser.tsx` (la usa `NubeBrowser`), `MemoryDialog.tsx` |
| `utility-panel` Pads / Click / Perfiles | `Pads.tsx`, `Click.tsx`, `ProfileDrawer.tsx` |
| Ajustes (+ Diagnóstico, nuevo) | `SettingsDrawer.tsx`, `fpsMonitor.ts`, `motion.ts` |
| `app-toast` | `.app-toast` (aviso de estado de `App.tsx`, se oculta solo a los 5 s) |

## Tokens y estilos
- `src/styles/tokens.css`: colores (fondo marino, plateados, familias de pista), radios, espacios, sombras, tipografía (`--fs-xs` = 11 px mínimo), `--tap` = 44 px, zonas seguras `--safe-*`, capas `--z-*`, movimiento. `--c-faint` subió a `#8996a8` (contraste ≥ 5:1).
- `src/styles/base.css`: reset, fondo, utilidades `contain-*`, pausa de animaciones con la app en segundo plano (`visibility.ts` pone `data-hidden`).
- Disposición: `App.css`; aspecto: `skin.css` y `skin-player.css` (las reglas de cada etapa están al final, con su cabecera). Pendiente de orden: la maqueta separa estilos por pantalla; aquí siguen en 3 archivos grandes.

## Qué se adaptó y por qué
- Etapa 2: la atmósfera del splash usaba `filter: blur(100px)` y el trazo de luz `drop-shadow`; ahora son degradados radiales estáticos (se ven igual y no pintan filtros).
- Etapa 3: el reloj salió de `App` (`clock.tsx`, `useSyncExternalStore`): el segundero repinta solo los textos de tiempo, la onda y la barra del reproductor. Controles de 44 dp. Quité los desenfoques de pantalla completa (`library-scrim`, `load-layer`) y puse fondos más oscuros.
- **Excepción medida**: `.topbar` conserva `backdrop-filter: blur(12px)` solo en «Completos». Quitarlo bajó ~10 % los fotogramas con la CPU 8x más lenta (la franja deja de tener su propia capa de composición).
- Etapa 4: el mini reproductor ahora **también se ve en horizontal** (antes se ocultaba): ocupa su propia fila bajo el contenido. «1 pista» en singular (`format.ts`). En horizontal bajo el botón PERFIL va en la barra superior; en vertical queda en la fila «Canción cargada».
- Etapa 5: M y S de 44×44; el brillo del fader pasó de `blur(7px)` a un degradado radial; los canales atenuados solo cambian opacidad (sin `filter`).
- Etapa 6: **Cancelar** (AbortController real en la descarga), **Reintentar** en errores, y el **aviso de memoria llena** deja elegir qué quitar del repertorio (antes quitaba canciones en silencio). «Preparando pistas 8/13» con barra de progreso. Avisos flotantes.
- Etapa 7: listas de artistas/canciones por ventanas (`windowed.tsx`, 40 filas y otras 40 al llegar al final).
- Etapa 8: nuevo panel **Ajustes** (normalización, efectos visuales, «El sistema pidió menos animaciones» con interruptor, perfiles, Diagnóstico). Si hay < 40 fps durante 5 s con «Completos», se **propone** pasar a «Reducidos» (nunca en silencio).
- Etapa 9: marcadores de sección (pulsación larga en la onda; nombre, posición y color; un toque salta; pulsación larga en el marcador lo edita). Guardados por canción en `localStorage` (con try/catch); sin marcadores no aparece la barra.
- Herramientas de desarrollo: `window.__demo(nombre, pistas, MBsimulados)` (solo en `npm run dev`) crea canciones sintéticas; `tools/measure-fps.mjs` mide fotogramas (ver su cabecera).

## Animaciones y efectos pesados (inventario)
Animadas solo con `transform`/`opacity` salvo lo indicado. «Reducidos» (`data-fx="reduced"`) apaga: partículas/atmósfera/destello del splash (`.fx-heavy`), aura giratoria de la tarjeta de carga, `.fader-glow`, brillo del cabezal, desenfoque de la barra superior, respiración de las órbitas de las carátulas, ondas del mini reproductor, pulso de los pads.
- `backdrop-filter`: 1 (barra superior, solo Completos). Antes: 4 (barra, `library-scrim`, `load-layer` y otros).
- `filter`: ya no hay `blur` ni `drop-shadow` animados. Queda `filter: brightness` al arrastrar un fader (un solo elemento).
- Medidores: un solo `requestAnimationFrame` (`meters.ts`), `transform: scaleY`, ≈40 fps en Completos / ≈20 en Reducidos; se detiene sin señal.
- Con la app en segundo plano: `animation-play-state: paused` (el audio sigue).
- `contain: content` en tarjetas del repertorio, filas de canciones y de biblioteca. En `.channel` se probó `contain: layout style` y **no mejoró** (medido), por eso no está.

## Medición de rendimiento
Edge sin cabeza (`tools/measure-fps.mjs`), 915×412 @2x móvil, 13 pistas sonando, compilación de producción, CPU ralentizada por CDP. Pantalla a ~75 Hz. «Antes» = commit `e112748`.

| Ralentización | Pantalla | Antes | Después |
|---|---|---|---|
| 4x | En vivo (mezclador) | 74,4 fps | 74,6 fps |
| 4x | Mezcla | 74,9 fps | 74,9 fps |
| 6x | En vivo | 57,2 fps | 56,2 fps |
| 6x | Mezcla | 72,0 fps | 67,7 fps |
| 8x | En vivo | 31,4 fps | 29,5–32,8 fps |
| 8x | Mezcla | 57,8 fps | 41–48 fps |

Lectura honesta: a 4x no hay diferencia; a 6x está dentro del ruido (±3 fps); a 8x (extremo) la pestaña Mezcla cae porque **ahora el mini reproductor se ve en horizontal** (pedido; quitarlo devolvía ~6 fps) y los botones M/S son más grandes. Las repeticiones varían ±5 fps. No se midió en un celular real.

## Lista de paridad
| Función | Dónde está ahora | Verificada |
|---|---|---|
| Logo, BPM y compás, CLICK, PAD | `.topbar` (`.tempo`, `.click-btn`, `.pad-btn`) | Sí: 915×412, 412×915, 1280×800 |
| Tiempo transcurrido/total | `HeaderClock` | Sí |
| Transporte (anterior, play/pausa, stop, siguiente) | `.transport` | Sí (play/pausa probado) |
| Efectos visuales | Ajustes › Efectos visuales (ya no es botón suelto) | Sí (se abre; el cambio no se pulsó) |
| REINICIAR | `.restart-btn` (solo icono en pantalla compacta) | Visual; no se pulsó |
| Indicador «En vivo» | `.sync-chip` y pastilla «SESIÓN EN VIVO» | Sí |
| Setlist: tarjetas, quitar, «+», activa resaltada | `songDeck` | Sí |
| Forma de onda con posición (tocar mueve) | `Waveform.tsx` | Parcial: se ve y sigue al sonar; el salto por toque no se pulsó |
| Mezclador: M, S, fader, medidor, paneo, nombre, valor | `ChannelStrip` | Sí (medidores vivos con la canción sonando) |
| MASTER: normalización (Apagado/Suave/Nivelar), volumen, «Salida principal» | `MasterStrip`, `MasterCard`, Ajustes | Visual; el cambio de modo no se pulsó |
| PERFIL (fábrica/predeterminado/canción; guardar, restablecer, exportar, importar) | `ProfileDrawer`, botón PERFIL | Solo existe y abre; guardar/importar no se pulsaron (`npm run verify` cubre la lógica) |
| Mini reproductor «Reproduciendo» | `.mini-player` (Mezcla y Biblioteca, también horizontal) | Sí en Mezcla 800×360 |
| Tarjeta de carga + progreso + Cancelar | `LoadCard` | **No** probada con red (no hay llaves de la nube); compila |
| Error con Reintentar | `LoadCard` modo error | **No** probada con red |
| Aviso de memoria llena + qué quitar | `MemoryDialog` | Sí (simulado con `__demo`: quitar y añadir) |
| Biblioteca: selector de fuente, «Este dispositivo» | `.library-panel`, `LocalImport` | Sí (visual) |
| Biblioteca Nube: buscador, artistas/canciones, tamaño/tono/BPM, Añadir, Actualizar, índice | `NubeBrowser` | **No** probada con datos reales (sin llaves); las ventanas de lista no se ejercitaron |
| Pads (notas, menor, sostenido, volumen) | `Pads.tsx` en cajón | Sí (visual) |
| Panel de Click (BPM, compás, volumen) | `Click.tsx` | Sin cambios de lógica; no se abrió esta sesión |
| Ajustes y Diagnóstico | `SettingsDrawer` | Sí |
| Toasts y splash | `.app-toast`, `Splash.tsx` | Toast sí; el splash no se vio en pantalla tras los cambios |
| Marcadores de sección | `MarkerEditor`, `.marker-bar` | Sí (crear, guardar, persistir, saltar) |

## Pendiente de confirmar en el celular
Fluidez real con 13–30 pistas; contraste bajo luz de tarima; descarga real (Cancelar/Reintentar); arranque nativo sin parpadeo; pulsación larga en la onda con el dedo; teclado del buscador.
