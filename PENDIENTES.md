# Pendientes después del lanzamiento

## Que no se corte el audio al tocar una canción no cargada (decidido: después del lanzamiento)
- Hoy: al tocar una canción de la nube que no está cargada, `setActiveUnloaded` (App.tsx) llama a `disposeActiveTracks()` y la que estaba sonando se suelta de inmediato, antes de que la nueva esté lista. Confirmado en modo dev (`?demo&catalog=demo`, nov 2026).
- Arreglo propuesto: separar «canción pedida» de «canción activa». La activa sigue sonando hasta que la pedida termine de descargarse; recién entonces `commitLoaded` la monta.
- Alcance estimado: 40–60 líneas en App.tsx. Toca `schedule()` (la ventana de memoria se calcula alrededor de la activa), `runDownload` (bandera foreground), `commitLoaded` y la tarjeta de carga (`LoadCard`), que hoy tapa el mezclador. Requiere probar de nuevo la ventana de memoria (`tools/verify-memory.ts`) y los reintentos.

## Decididos: se quedan como están
- La tarjeta fallida en el repertorio del mezclador mide lo mismo que las demás (34 px en horizontal, 38 px en vertical).
- Las × de quitar canción (24 px) y eliminar pista (20 px), y los filtros Todas/Disponibles (32 px), quedan sin cambios.
