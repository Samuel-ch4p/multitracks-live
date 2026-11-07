# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Operadores y músicos que usan multitracks en el culto: mezclan y disparan pistas en vivo desde un celular o tablet en horizontal, con poco tiempo para tocar la pantalla y, a menudo, poca luz. Acceden con una cuenta de la comunidad Crescendo.

## Product Purpose
Crescendo Live es un reproductor y mezclador multitrack en vivo. Reproduce canciones de la Nube Crescendo (con cuenta) o de archivos del dispositivo (pistas sueltas, ZIP o RAR), con mezcla por canal, click, pads, setlists y ajustes recordados por canción. Éxito: que el operador monte el setlist y sostenga el culto sin errores ni fricción.

## Positioning
Combina una biblioteca propia en la nube de Crescendo con archivos locales, y está pensada para el directo (setlists, click, pads, faders táctiles, memoria de ajustes por canción). Funciona dentro del APK, sin servidor propio para el audio.

## Operating Context
- App Android empaquetada con Capacitor (React + Vite + TypeScript), siempre en horizontal; también corre en navegador de escritorio para desarrollo.
- Distribución por instalación directa del APK (compilado con GitHub Actions o Android Studio), a una comunidad cerrada con cuenta.
- Catálogo y canciones en almacenamiento en la nube (R2) con catálogo generado (`catalog.json`); el acceso pasa por login y un worker.
- Las canciones solo se abren como `.zip` (audio en la raíz) o archivos locales; el RAR se admite desde el dispositivo.
- Uso en vivo: manos rápidas, pantalla encendida mientras suena el click, teclado que a veces tapa la pantalla.

## Capabilities and Constraints
- Biblioteca: buscador, artistas, canciones sin zip aparecen como "Próximamente".
- Reproductor: faders, paneo, volumen maestro, familias de pistas, marcadores, forma de onda, click (BPM 30–300), pads por tono.
- Setlists guardados y configuración por canción de los cultos.
- Formatos de audio: wav, mp3, ogg, m4a, aac, flac, aiff/aif.
- Ámbito de plataforma: web técnica en contenedor Android; no se busca lenguaje de diseño nativo.
- Sin definir: iOS, modelo de cuentas más allá del acceso actual, y cualquier plan comercial.

## Brand Commitments
Nombre Crescendo / Crescendo Live. Identidad visual vigente (confirmada por el usuario): grafito casi negro con tinte azul leve y acento cobre (el logo y el splash usan la "C" cobre y plata); tipografía Inter en el mezclador. Algunos tokens heredan nombres antiguos (por ejemplo `--c-silver-100` vale cobre). El id interno de la app sigue siendo `com.redline.multitracks`.

## Evidence on Hand
- Capturas y propuestas de rediseño en `diseno/` (`capturas`, `rediseno`).
- Catálogo real en R2 (cientos de canciones) y `lista_r2.txt`/`catalog.json` en el servidor.
- No hay testimonios, métricas de uso ni precios documentados: no inventarlos.

## Product Principles
1. En directo, lo primero es no fallar: sin sorpresas, sin pasos extra, controles grandes y predecibles.
2. La canción manda: lo que suena y su estado deben leerse de un vistazo, en poca luz.
3. La biblioteca debe sentirse propia de la comunidad Crescendo, no un reproductor genérico.
4. Lo que el operador ajustó se recuerda; no se le pide repetirlo.
5. Funciona aunque el entorno sea malo: pantalla pequeña, teclado abierto, conexión inestable.

## Accessibility & Inclusion
Sin requisito formal establecido. Se asume uso táctil, en horizontal y con poca luz; contraste y tamaños de toque son prioridad práctica. Interfaz en español.
