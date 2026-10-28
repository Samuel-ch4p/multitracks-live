/**
 * Marca <html data-hidden="true"> cuando la app está en segundo plano para pausar las animaciones decorativas
 * (ver base.css). El audio no se toca: sigue sonando.
 */
export function watchVisibility() {
  const apply = () => { document.documentElement.dataset.hidden = document.visibilityState === "hidden" ? "true" : "false"; };
  document.addEventListener("visibilitychange", apply);
  apply();
}
