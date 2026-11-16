# Pendientes

## Hecho en la 1.1.0 (rama diseno-nuevo, sin publicar todavía)
- **Corte de audio al tocar una canción no cargada**: resuelto. La pedida se descarga mientras la actual sigue sonando y montada
  (`src/songSwitch.ts`); nunca se corta una canción sin que el usuario lo pida. Si no caben en memoria, la pedida espera a que se
  detenga la actual.
- Sesión que se cerraba por un fallo de red al renovar el token (B1), marcadores que se perdían (I2), notas legales en el APK,
  certificado verificado en Actions, cambio de canción con «mantener pulsado» mientras suena (I1), pausas externas (I5), cierre por
  inactividad 30/180 min (I3), arranque sin red 72 h (I4), descargas reanudables (I6), quitar la activa pasa a la siguiente (P4),
  ZIP por bloques sin DecompressionStream (P6), zonas táctiles de 44 px (P9), fader con modo fino, canciones locales en cultos.
- **Cambian decisiones anteriores** (antes «se quedan como están»): las × de quitar canción y los filtros tienen ahora zona táctil de
  44 px (sin cambiar su tamaño visible) y las tarjetas del repertorio miden 44 px de alto.

## Pendiente antes de publicar la 1.1.0
- Pruebas manuales en celular (lista en el reporte de la 1.1.0): llamada entrante, audífonos, modo avión > 1 h, letra grande del
  sistema, Android viejo, descarga cortada a mitad, cambio de canción mientras suena.
- Push de `diseno-nuevo`, merge a `main` y compilación en Actions (el flujo ahora falla si el certificado no es el esperado).

## Servidor (preparado en `D:\crescendo-servidor\parches_1_1\`, sin aplicar)
- Verificar qué está desplegado (endurecimiento, override, Worker): `01_verificar_despliegue.sql` y `02_ver_worker_desplegado.md`.
- P1 (Worker: no enumerar claves), P2 (members: solo columnas que usa la app), P3 (IP/país de authorize_download).
- I7: SMTP propio en Supabase (`SMTP_PROPIO.md`). Pausa por inactividad del plan gratis y alertas de facturación de Cloudflare.

## Decisiones de Samuel con asesoría legal (`parches_1_1/DECISIONES_SAMUEL.md`)
- Permisos de los creadores de las pistas, reembolsos, representante legal de la S.A.S., autorización de menores, plazos de respuesta.

## Para después (1.2)
- Excepciones táctiles medidas que siguen por debajo de 44 px: la onda (40 px de alto), la × del aviso de marcadores y M/S de Click
  y Guía (36–38 px de ancho en un canal de 78 px). Ver el final de `src/styles/touch.css`.
- Con letra grande, el paneo de Click y Guía («100L» junto a L/R) queda apretado; el texto no se corta pero se toca.
- El bundle principal pasa de 500 kB (aviso de Vite, ya existía): dividir en trozos si el arranque en celulares lentos se nota.
- Quitar con la × la canción que suena (mientras suena) la corta sin pedir confirmación.
