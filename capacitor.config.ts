import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.redline.multitracks",
  appName: "Redline MultiTracks",
  webDir: "dist",
  backgroundColor: "#050506",
  android: {
    allowMixedContent: false,
    adjustMarginsForEdgeToEdge: "force",
  },
};

export default config;
