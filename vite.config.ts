import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Configuration recommandée par Tauri : port fixe, pas d'effacement de l'écran.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022" },
});
