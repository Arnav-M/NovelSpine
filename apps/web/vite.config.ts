import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sidecarTarget = "http://127.0.0.1:8765";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      "/novelflow-api": {
        target: sidecarTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/novelflow-api/, ""),
      },
    },
  },
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
});
