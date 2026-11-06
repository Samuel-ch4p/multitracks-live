import { isDownloading } from "./cloud/cloudSource";
import { GRACIA_FUERA_MIN, INACTIVIDAD_MIN } from "./cloud/config";
import { cloudStorage } from "./cloud/storage";
import { absenceExpired, idleExpired, parseLeaveRecord, type LeaveRecord } from "./inactivityRules";

/**
 * Cierre de sesión por ausencia e inactividad, con MARCAS DE TIEMPO persistidas (no temporizadores: el WebView de Android se
 * suspende en segundo plano). Solo se guarda cuándo se salió y si sonaba audio; nada más.
 *  · Al pasar a segundo plano: se guarda leftAt y wasPlaying.
 *  · Al volver (o en arranque en frío): sin audio al salir y > GRACIA_FUERA_MIN → cerrar; con audio al salir y > INACTIVIDAD_MIN → cerrar.
 *  · En primer plano sin interacción ni audio durante INACTIVIDAD_MIN → cerrar.
 *  · Nunca mientras suena audio ni mientras hay una descarga en curso.
 */
const KEY = "crescendo.ausencia.v1";

let audioActive = false;
let lastActivity = Date.now();

/** App avisa cuándo suena algo (pistas, click o pad). Mientras suene cuenta como actividad. */
export function setAudioActive(active: boolean) {
  audioActive = active;
  if (active) lastActivity = Date.now();
}

const busy = () => audioActive || isDownloading();

async function readRecord(): Promise<LeaveRecord | null> {
  try { return parseLeaveRecord(await cloudStorage().get(KEY)); } catch { return null; }
}
async function clearRecord() {
  try { await cloudStorage().remove(KEY); } catch { /* sin almacenamiento */ }
}
/** Copia en memoria de la última salida: si el proceso sobrevivió, es más fiable que releer el almacenamiento. */
let memoryLeave: LeaveRecord | null = null;
function writeRecord() {
  const record: LeaveRecord = { leftAt: Date.now(), wasPlaying: audioActive };
  memoryLeave = record;
  void cloudStorage().set(KEY, JSON.stringify(record)).catch(() => { /* sin almacenamiento */ });
}

/** Arranque en frío: ¿se pasó la ausencia permitida desde la última vez que se salió? Consume la marca. */
export async function expiredOnStart(): Promise<boolean> {
  const record = await readRecord();
  await clearRecord();
  lastActivity = Date.now();
  return absenceExpired(record, Date.now(), false, GRACIA_FUERA_MIN, INACTIVIDAD_MIN);
}

/** Vigila ausencia e inactividad mientras haya sesión. Devuelve la función que lo detiene. */
export function startInactivityWatch(onExpire: () => void): () => void {
  lastActivity = Date.now();
  let fired = false;
  const expire = () => { if (!fired) { fired = true; onExpire(); } };

  const touch = () => { lastActivity = Date.now(); };
  const activityEvents = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"] as const;
  activityEvents.forEach((name) => window.addEventListener(name, touch, { capture: true, passive: true }));

  const leave = () => writeRecord();
  const comeBack = async () => {
    const record = memoryLeave ?? (await readRecord());
    memoryLeave = null;
    await clearRecord();
    if (absenceExpired(record, Date.now(), busy(), GRACIA_FUERA_MIN, INACTIVIDAD_MIN)) expire();
    else touch(); // volver a la app cuenta como interacción
  };
  const onVisibility = () => { if (document.visibilityState === "hidden") leave(); else void comeBack(); };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", leave);
  document.addEventListener("freeze", leave);
  document.addEventListener("resume", onVisibility);

  // Sondeo barato en primer plano: compara marcas de tiempo, así que si el sistema lo congeló basta con que despierte.
  const poll = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (busy()) { lastActivity = Date.now(); return; } // con audio o descarga cuenta como actividad: la cuenta empieza al terminar
    if (idleExpired(lastActivity, Date.now(), false, INACTIVIDAD_MIN)) expire();
  }, 30_000);

  return () => {
    activityEvents.forEach((name) => window.removeEventListener(name, touch, { capture: true }));
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", leave);
    document.removeEventListener("freeze", leave);
    document.removeEventListener("resume", onVisibility);
    window.clearInterval(poll);
  };
}
