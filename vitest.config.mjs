import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["normalize/**/*.test.mjs", "verify/**/*.test.mjs"] } });
