/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // three.js и R3F — отдельный чанк, грузится только при открытии 3D.
        manualChunks(id) {
          if (/node_modules\/(three|@react-three|three-stdlib|troika|camera-controls|maath|meshline|stats-gl|@monogrid)/.test(id)) {
            return "three";
          }
          if (/node_modules\/(react|react-dom|scheduler|zustand)\//.test(id)) return "react";
          return undefined;
        },
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
