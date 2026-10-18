import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./index.css";
import App from "./App.tsx";

// Limpieza: borra cualquier copia de canciones que una versión de prueba anterior haya dejado en el teléfono.
try { indexedDB.deleteDatabase("crescendo-songs"); } catch { /* sin almacenamiento */ }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
