/**
 * Abre un enlace FUERA de la app: https://wa.me/… abre la app de WhatsApp (o el navegador si no está instalada) y mailto: abre el
 * cliente de correo. En Android se usa @capacitor/app-launcher, que lanza un Intent ACTION_VIEW del sistema; así el enlace nunca se
 * queda dentro de la vista interna de la app. En navegador o escritorio cae a window.open / location.
 */
export async function openExternal(url: string): Promise<void> {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) {
    try {
      const { AppLauncher } = await import("@capacitor/app-launcher");
      const { completed } = await AppLauncher.openUrl({ url });
      if (completed) return;
    } catch {
      /* se intenta de otra forma abajo */
    }
  }
  if (url.startsWith("mailto:")) window.location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
}
