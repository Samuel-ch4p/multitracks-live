# Crescendo Live

Reproductor/mezclador multitrack con Web Audio. Carga canciones desde MEGA o desde archivos del dispositivo (pistas sueltas, ZIP o RAR). Funciona sin servidor: la app Android lleva todo dentro.

## Desarrollo (PC)

```
npm install
npm run dev
```

## Generar el APK de Android

El proyecto Android ya está en `android/` (Capacitor). Hay dos caminos:

### A) Sin instalar nada: GitHub compila el APK
1. Crea un repositorio en GitHub y sube esta carpeta (incluida `android/` y `.github/`).
2. En GitHub ve a **Actions → Compilar APK de Android → Run workflow**.
3. Al terminar (unos 5 min), descarga **crescendo-live-apk** → dentro está `app-debug.apk`.

### B) En tu PC con Android Studio
1. Instala Android Studio.
2. En esta carpeta: `npm install` y luego `npm run android:sync`.
3. `npm run android:open` abre el proyecto → **Build ▸ Build Bundle(s) / APK(s) ▸ Build APK(s)**.
4. El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`.

## Instalar en el celular
1. Pasa `app-debug.apk` al celular (WhatsApp, Drive, cable…).
2. Ábrelo; si Android lo pide, permite **instalar apps de esta fuente**.
3. Abre **Crescendo Live**.

## Después de cambiar el código
`npm run android:sync` y vuelve a compilar el APK. Si cambias el icono, edita `assets/` y corre `npm run assets`.

## Click
Botón **CLICK** (arriba): BPM de 30 a 300 (escribirlo, ±1/±5, deslizador o TAP), 2–8 pulsos por compás, subdivisión (×2, ×3, ×4), acento en el primer pulso, 3 sonidos, volumen y salida **mezclado** o **solo izquierdo**. Los ajustes se recuerdan y el click sigue sonando aunque cierres el panel. Mantiene la pantalla encendida mientras suena.

## Estructura
- `src/App.tsx` reproductor, mezcla, transporte
- `src/Fader.tsx`, `src/Waveform.tsx` faders y forma de onda
- `src/archive.ts` ZIP/RAR, formatos y forma de onda
- `src/MegaBrowser.tsx`, `src/LocalImport.tsx` fuentes de canciones
- `src/metronome.ts`, `src/Click.tsx` motor y panel del click
- `capacitor.config.ts` datos de la app Android (nombre; el id interno sigue siendo `com.redline.multitracks` para que el APK nuevo se instale encima del anterior)
