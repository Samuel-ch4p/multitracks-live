import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { findDraftMarkers, stripDraftNotes } from "./src/legalNotes.ts";

/**
 * Textos legales: las notas internas del borrador ([CONFIRMAR …], "*Borrador…") se quitan al compilar, así no viajan en el APK.
 * Además, el build FALLA si alguna de esas marcas aparece en cualquier archivo publicado (red de seguridad).
 */
function legalDraftNotes(): Plugin {
  return {
    name: "crescendo-legal-draft-notes",
    enforce: "pre",
    load(id) {
      const [path, query] = id.split("?");
      if (query !== "raw" || !path.split("\\").join("/").endsWith("/legal/politica-y-terminos.md")) return null;
      return `export default ${JSON.stringify(stripDraftNotes(readFileSync(path, "utf-8")))};`;
    },
    generateBundle(_options, bundle) {
      for (const [name, output] of Object.entries(bundle)) {
        const text = output.type === "chunk" ? output.code : typeof output.source === "string" ? output.source : "";
        const found = findDraftMarkers(text);
        if (found.length) this.error(`Notas internas del borrador legal en ${name}: ${found.join(", ")}`);
      }
    },
  };
}

export default defineConfig({
  plugins: [legalDraftNotes(), react()],
  build: {
    // Release: minificado y SIN mapas de código (no se publica el código fuente original).
    minify: "oxc",
    sourcemap: false,
  },
});
