import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // El grafo de imports de send.ts/credentials.ts (feature 018: transcripción
    // de audio vía @/lib/ai) tarda >5s en transformarse en frío en máquinas
    // cargadas; el default de Vitest lo reporta como timeout, no como bug real.
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
