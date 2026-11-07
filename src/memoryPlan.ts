/**
 * Ventana de canciones cargadas en memoria. El setlist puede tener cualquier número de canciones (son referencias); solo se mantienen
 * CARGADAS (en RAM, nunca en disco) la activa, la anterior inmediata y las siguientes, mientras quepan en el presupuesto.
 * Lógica pura (sin React ni red) para poder probarla: ver tools/verify-memory.ts.
 */

/** Constantes de la ventana (valores en src/cloud/config.ts → MEMORIA). */
export type MemoryConfig = {
  /** Fracción de la RAM del dispositivo que pueden ocupar las canciones cargadas. */
  fraccion: number;
  minMB: number;
  maxMB: number;
  /** Cuántas canciones anteriores y siguientes se intentan mantener cargadas. */
  anteriores: number;
  siguientes: number;
  /** Margen para el pico de una descarga/extracción (medido: ≈ 1,25× el archivo al cargar la canción activa). */
  factorPico: number;
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Presupuesto en bytes para las canciones cargadas. `deviceMemoryGB` es navigator.deviceMemory (redondeado; puede faltar). */
export function memoryBudgetBytes(deviceMemoryGB: number | undefined, config: MemoryConfig, overrideMB?: number): number {
  if (overrideMB && overrideMB > 0) return overrideMB * MB;
  const gb = deviceMemoryGB && deviceMemoryGB > 0 ? deviceMemoryGB : 4;
  return Math.min(config.maxMB * MB, Math.max(config.minMB * MB, config.fraccion * gb * GB));
}

export type PlanSong = {
  id: number;
  /** Viene de la nube (se puede volver a descargar). Las de «Este dispositivo» no cuentan ni se liberan. */
  cloud: boolean;
  loaded: boolean;
  /** Bytes en memoria si está cargada; si no, tamaño que tendrá al cargarla (catálogo). */
  bytes: number;
};

export type Plan = {
  /** Cargadas que se quedan (por prioridad). */
  keep: number[];
  /** Por cargar, en orden de prioridad: la primera es la activa si hace falta. */
  load: number[];
  /** Cargadas que quedan fuera de la ventana: se liberan (Blobs incluidos). */
  release: number[];
  /** La siguiente que no cabe ahora junto a la actual: se carga en cuanto se libere memoria. */
  waiting: number | null;
  /** Bytes que ocuparán las que se quedan. */
  used: number;
};

/**
 * Prioridad: activa > siguiente > anterior > segunda siguiente > …  La activa siempre se carga (aunque sola exceda el presupuesto).
 * Las demás se admiten solo si caben; una no cargada se admite con margen de pico (factorPico), una ya cargada con su tamaño real.
 * Con `preload` apagado solo se conservan la activa y la anterior (la siguiente se carga al elegirla).
 */
export function planWindow(songs: PlanSong[], activeIndex: number, budget: number, config: Pick<MemoryConfig, "anteriores" | "siguientes" | "factorPico">, preload: boolean): Plan {
  const plan: Plan = { keep: [], load: [], release: [], waiting: null, used: 0 };
  if (activeIndex < 0 || activeIndex >= songs.length) {
    plan.release = songs.filter((song) => song.cloud && song.loaded).map((song) => song.id);
    return plan;
  }
  const order: number[] = [activeIndex];
  const next = preload ? config.siguientes : 0;
  for (let k = 1; k <= Math.max(next, config.anteriores); k++) {
    if (k <= next && activeIndex + k < songs.length) order.push(activeIndex + k);
    if (k <= config.anteriores && activeIndex - k >= 0) order.push(activeIndex - k);
  }
  for (const index of order) {
    const song = songs[index];
    if (!song.cloud) continue;
    const isActive = index === activeIndex;
    const need = song.loaded ? song.bytes : song.bytes * config.factorPico;
    if (isActive || plan.used + need <= budget) {
      plan.keep.push(song.id);
      plan.used += song.bytes;
      if (!song.loaded) plan.load.push(song.id);
    } else if (plan.waiting === null && !song.loaded && index === activeIndex + 1) {
      plan.waiting = song.id;
    }
  }
  const kept = new Set(plan.keep);
  plan.release = songs.filter((song) => song.cloud && song.loaded && !kept.has(song.id)).map((song) => song.id);
  return plan;
}
