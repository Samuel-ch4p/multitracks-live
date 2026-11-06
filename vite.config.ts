import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Release: minificado y SIN mapas de código (no se publica el código fuente original).
    minify: "oxc",
    sourcemap: false,
  },
});
