/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 900,
    // three.js попадает в ленивый чанк Scene3D (dynamic import в app/Stage.tsx),
    // поэтому стартовый бандл остаётся лёгким.
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
