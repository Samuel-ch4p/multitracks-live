import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.redline.multitracks",
  appName: "Crescendo Live",
  webDir: "dist",
  backgroundColor: "#080B11",
  android: {
    allowMixedContent: false,
    adjustMarginsForEdgeToEdge: "force",
  },
};

export default config;
