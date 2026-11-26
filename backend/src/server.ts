import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createAnthropicLabelProvider } from "@diet-companion/label-reader";
import pg from "pg";
import { buildApp } from "./app.js";
import { PostgresSessionStore, PostgresThrottleStore } from "./auth/postgres-auth-store.js";
import { PostgresDishStore } from "./postgres-dish-store.js";
import { PostgresPlanStore } from "./postgres-plan-store.js";
import { PostgresProductStore } from "./postgres-store.js";
import { PostgresTargetStore } from "./postgres-target-store.js";
import { parseServerConfig } from "./server-config.js";
import { registerClient } from "./static.js";
import { parseOwnerTimeZone } from "./today.js";

/** The production entry (backend script `start`). Migrations run as a separate step. */
async function main(): Promise<void> {
  const config = parseServerConfig(process.env);
  // Refuses to start when OWNER_TIME_ZONE is missing or not a valid IANA zone (ADR-016/C-002).
  const timeZone = parseOwnerTimeZone(process.env);

  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  // An idle client can fail (for example a restart of the database); log the message only, never connection details.
  pool.on("error", (error: Error) => {
    console.error(`database pool error: ${error.message}`);
  });

  // The Claude provider (ADR-005) is used only when the key is set; the key is never logged.
  const providerKey = process.env.ANTHROPIC_API_KEY?.trim();
  const labelProvider = providerKey
    ? createAnthropicLabelProvider({
        apiKey: providerKey,
        model: process.env.ANTHROPIC_MODEL?.trim() || undefined,
        log: (message: string) => console.log(message),
      })
    : undefined;

  const app = buildApp({
    store: new PostgresProductStore(pool, randomUUID),
    dishStore: new PostgresDishStore(pool, randomUUID),
    targetStore: new PostgresTargetStore(pool),
    planStore: new PostgresPlanStore(pool, randomUUID),
    timeZone,
    auth: {
      sessions: new PostgresSessionStore(pool),
      throttle: new PostgresThrottleStore(pool),
      passwordHash: config.ownerPasswordHash,
    },
    checks: {
      database: async () => {
        await pool.query("SELECT 1");
        return true;
      },
    },
    // Without ANTHROPIC_API_KEY, labelProvider is unset: label photos answer 502 recognition.unavailable.
    labelProvider,
  });

  // The built client sits next to the backend: <root>/backend/dist/server.js and <root>/client/dist.
  registerClient(app, join(import.meta.dirname, "..", "..", "client", "dist"));

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "shutdown failed");
        process.exit(1);
      });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await app.listen({ host: "0.0.0.0", port: config.port });
  console.log(`Listening on port ${config.port}`);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "startup failed");
    process.exit(1);
  });
}
