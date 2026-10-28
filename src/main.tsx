import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./styles/tokens.css";
import "./styles/base.css";
import { applyFx } from "./effects";
import { watchVisibility } from "./visibility";
import { applyMotion } from "./motion";
import App from "./App.tsx";

// Limpieza: borra cualquier copia de canciones que una versión de prueba anterior haya dejado en el teléfono.
try { indexedDB.deleteDatabase("crescendo-songs"); } catch { /* sin almacenamiento */ }

applyFx();
applyMotion();
watchVisibility();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Quita el logo estático de index.html cuando la app ya pintó su propia pantalla de inicio (mismo logo en el mismo sitio).
requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById("boot")?.remove()));
