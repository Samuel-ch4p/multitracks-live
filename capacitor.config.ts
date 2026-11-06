import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.redline.multitracks",
  appName: "Crescendo Live",
  webDir: "dist",
  backgroundColor: "#080B11",
  android: {
    allowMixedContent: false,
    // Depuración del WebView APAGADA en todas las compilaciones (chrome://inspect no ve la app).
    // Solo para depurar en tu propio equipo: CAP_DEBUG=1 npx cap sync android
    webContentsDebuggingEnabled: process.env.CAP_DEBUG === "1",
    adjustMarginsForEdgeToEdge: "force",
  },
};

export default config;
