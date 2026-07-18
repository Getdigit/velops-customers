import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Power Pages code site: the compiled site in dist/ is what
// `pac pages upload-code-site` publishes (see powerpages.config.json).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  server: {
    port: 3000,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
  },
});
