import { defineConfig } from "vitest/config";

// INTEGRATION=1 (npm run test:integration) runs only the database tests, *.int.test.ts, against
// DATABASE_URL. Plain `npm test` excludes them and needs no database.
const integration = process.env.INTEGRATION === "1";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: integration
      ? ["backend/src/**/*.int.test.ts"]
      : [
          "client/src/**/*.test.{ts,tsx}",
          "backend/src/**/*.test.ts",
          "label-reader/src/**/*.test.ts",
        ],
    exclude: integration ? ["**/node_modules/**"] : ["**/node_modules/**", "**/*.int.test.ts"],
    reporters: ["default", "junit"],
    outputFile: { junit: integration ? "reports/integration.xml" : "reports/unit.xml" },
  },
});
