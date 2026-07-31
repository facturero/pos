import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Config pensada para correr dentro de la webview de Tauri:
// - host fijo + puerto fijo para que Tauri sepa a qué URL apuntar en dev.
// - clearScreen:false para no perder los logs de "cargo" en la consola.
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
