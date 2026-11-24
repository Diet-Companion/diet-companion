import { defineConfig } from "vitest/config";

// INTEGRATION=1 (npm run test:integration) runs only the database tests, *.int.test.ts, against
// DATABASE_URL. API=1 (npm run test:api) runs only the API layer, tests/api/**/*.api.test.ts, also against
// DATABASE_URL. Plain `npm test` excludes both and needs no database.
const integration = process.env.INTEGRATION === "1";
const api = process.env.API === "1";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: api
      ? ["tests/api/**/*.api.test.ts"]
      : integration
      ? ["backend/src/**/*.int.test.ts"]
      : [
          "client/src/**/*.test.{ts,tsx}",
          "backend/src/**/*.test.ts",
          "label-reader/src/**/*.test.ts",
        ],
    exclude: integration || api ? ["**/node_modules/**"] : ["**/node_modules/**", "**/*.int.test.ts"],
    reporters: ["default", "junit"],
    outputFile: { junit: api ? "reports/api.xml" : integration ? "reports/integration.xml" : "reports/unit.xml" },
  },
});
