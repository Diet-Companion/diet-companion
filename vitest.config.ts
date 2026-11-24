import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: [
      "client/src/**/*.test.{ts,tsx}",
      "backend/src/**/*.test.ts",
      "label-reader/src/**/*.test.ts",
    ],
    reporters: ["default", "junit"],
    outputFile: { junit: "reports/unit.xml" },
  },
});
