/**
 * Canción PEDIDA frente a canción ACTIVA (1.1.0). Antes, tocar una canción de la nube no cargada soltaba en el acto la que sonaba y el
 * mezclador quedaba vacío mientras descargaba. Ahora la que suena sigue montada (y sonando) mientras se descarga la pedida.
 * Reglas puras (se prueban en tools/verify-song-switch.ts):
 *  · decideSwitch: qué hacer al elegir una canción.
 *  · fitsAlongside: ¿caben en memoria la que suena y la pedida (con el pico de descarga)?
 *  · requestedCanStart: si no caben, la pedida espera a que se detenga la que suena (nunca se corta audio por memoria).
 *  · onRequestedLoaded: terminada la descarga, se monta solo si no hay nada sonando ni en pausa; si no, queda lista para tocarla
 *    (o se monta sola al detener). NUNCA se corta una canción que suena sin que el usuario lo pida.
 */

export type SwitchDecision =
  /** Ya está cargada (o es de «Este dispositivo»): se monta ahora, como siempre. */
  | "load-now"
  /** No hay nada montado: queda activa y se descarga (no hay audio que cortar). */
  | "replace"
  /** Hay algo montado: sigue montado y la elegida se descarga como «pedida». */
  | "request";

export function decideSwitch(s: { targetLoaded: boolean; targetCloud: boolean; mounted: boolean }): SwitchDecision {
  if (s.targetLoaded || !s.targetCloud) return "load-now";
  return s.mounted ? "request" : "replace";
}

/** ¿Cabe la pedida (con su pico de descarga y extracción) junto a la que está montada? `mountedBytes` = 0 si la montada es local. */
export function fitsAlongside(mountedBytes: number, requestedBytes: number, budget: number, factorPico: number): boolean {
  return mountedBytes + requestedBytes * factorPico <= budget;
}

/**
 * ¿Se puede empezar a descargar la pedida?
 *  · start: cabe junto a la montada.
 *  · wait: no cabe y la montada suena o está en pausa → se espera a que se detenga.
 *  · replace: no cabe y no suena nada → se suelta la montada y se descarga (como antes; no hay audio que cortar).
 */
export function requestedCanStart(s: { fits: boolean; playing: boolean; paused: boolean }): "start" | "wait" | "replace" {
  if (s.fits) return "start";
  return s.playing || s.paused ? "wait" : "replace";
}

/** Terminó de descargarse la pedida: ¿se monta ya? Solo si no suena nada ni está en pausa. */
export function onRequestedLoaded(s: { playing: boolean; paused: boolean }): "mount" | "hold" {
  return s.playing || s.paused ? "hold" : "mount";
}
