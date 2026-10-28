/**
 * TODOS los umbrales de la normalización, en un solo lugar. Niveles en dBFS salvo que se diga otra cosa.
 *
 * Enfoque (conservador y transparente):
 *  - Se mide una sola vez por canción el nivel de la MEZCLA de las pistas musicales juntas (ventanas de 0,4 s, ignorando silencios)
 *    y se aplica UNA sola ganancia a todas las pistas musicales por igual. El balance original del multitrack no se toca.
 *  - Click y Guía (familia "Guía y Click" de trackFamilies.ts) quedan fuera: ni se miden para nivel ni reciben ganancia.
 *  - La ganancia se fija antes de empezar y no cambia mientras suena (solo si el usuario cambia el modo, con rampa corta).
 *  - Techo de pico de la mezcla musical: -1 dBFS (estimación para no pasarse + limitador suave de seguridad en el audio).
 */

export type NormMode = "off" | "soft" | "level";

export const NORM_MODES: NormMode[] = ["off", "soft", "level"];

export const NORM_MODE_LABEL: Record<NormMode, string> = {
  off: "Apagado",
  soft: "Suave",
  level: "Nivelar pistas",
};

/** Modo por defecto. */
export const DEFAULT_NORM_MODE: NormMode = "soft";

/** Nivel de referencia de la mezcla musical (potencia media con compuerta, a faders sin tocar). */
export const REFERENCE_DB = -16;

/** Límites de la ganancia única por canción (y de cada corrección de "Nivelar pistas"). */
export const MAX_GAIN_DB = 6;
export const MIN_GAIN_DB = -6;

/** Techo de pico de la mezcla musical. El limitador suave del audio nunca deja pasar más que esto. */
export const PEAK_CEILING_DB = -1;
/** Los picos de pistas distintas rara vez coinciden: la mezcla estimada suma los picos en potencia + este margen. */
export const PEAK_COINCIDENCE_DB = 3;
/** El limitador deja pasar sin tocar todo lo que esté por debajo de este nivel (curva lineal hasta aquí, suave hasta el techo). */
export const LIMITER_KNEE_DB = -3;
/** El sobremuestreo del limitador puede pasarse ~0,15 dB del techo con entradas extremas (medido en Chromium): la curva termina este margen por debajo. */
export const LIMITER_OVERSHOOT_DB = 0.3;

/** Compuertas de silencio al medir. Una ventana por debajo del absoluto no cuenta; tampoco la que esté muy por debajo de la media. */
export const BLOCK_SECONDS = 0.4;
export const SILENCE_ABS_POWER = 1e-5; // -50 dB de potencia
export const SILENCE_REL_DB = -20; // relativo a la media de las ventanas audibles

/** "Nivelar pistas": solo se corrigen pistas MUY fuera de rango respecto de la mediana de las pistas musicales. */
export const LEVEL_OUTLIER_DB = 9; // desviación tolerada antes de corregir
export const LEVEL_MIN_TRACK_DB = -55; // pistas más bajas que esto se consideran ruido/silencio y no se tocan

/** Rampa (segundos) al cambiar de ganancia (cambio de modo en vivo, quitar una pista...). Evita clics. */
export const NORM_RAMP_SECONDS = 0.12;
