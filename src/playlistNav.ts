/**
 * Navegación del setlist (reglas puras, probadas en tools/verify-playlist-nav.ts).
 */

/**
 * Al quitar la canción ACTIVA, ¿cuál pasa a ser la activa? La que venía después (que ahora ocupa su posición);
 * si era la última, la anterior. Antes saltaba siempre a la primera del setlist.
 * `next` es la lista YA sin la canción quitada; `removedIndex` la posición que ocupaba. Devuelve el índice o -1 si la lista quedó vacía.
 * `skip` permite saltar canciones que no se pueden usar (p. ej. las marcadas «No se pudo cargar»), igual que Anterior/Siguiente.
 */
export function indexAfterRemoval<T>(next: T[], removedIndex: number, skip: (item: T) => boolean = () => false): number {
  if (next.length === 0) return -1;
  const start = Math.min(Math.max(removedIndex, 0), next.length - 1);
  for (let i = start; i < next.length; i++) if (!skip(next[i])) return i;
  for (let i = start - 1; i >= 0; i--) if (!skip(next[i])) return i;
  return start; // todas marcadas: se activa la de su posición (el usuario verá «No se pudo cargar» y podrá reintentar)
}
