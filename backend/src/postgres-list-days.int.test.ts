import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { runMigrations } from "./migrate.js";
import { PostgresDishStore } from "./postgres-dish-store.js";
import { PostgresPlanStore } from "./postgres-plan-store.js";
import { PostgresProductStore } from "./postgres-store.js";
import { PostgresTargetStore } from "./postgres-target-store.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point at a test database");

const schema = `t_${randomUUID().replace(/-/g, "")}`;
const options = `-c search_path=${schema}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
let pool: pg.Pool;
let app: ReturnType<typeof buildApp>;
// Today is 2026-03-10 in UTC. The first day of use is 2026-03-01 (the first saved range).
const at = new Date("2026-03-10T10:00:00Z");

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  const client = new pg.Client({ connectionString: url, options });
  await client.connect();
  try {
    await runMigrations(client, join(import.meta.dirname, "..", "migrations"));
  } finally {
    await client.end();
  }
  pool = new pg.Pool({ connectionString: url, options, max: 4 });
  const targets = new PostgresTargetStore(pool);
  await targets.save({ nutrient: "calories", minimum: 1800, maximum: 2200, effective_from: "2026-03-01" });
  app = buildApp({
    store: new PostgresProductStore(pool, randomUUID),
    dishStore: new PostgresDishStore(pool, randomUUID),
    targetStore: targets,
    planStore: new PostgresPlanStore(pool, randomUUID),
    isOwner: () => true,
    clock: () => at,
    timeZone: "UTC",
  });
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

describe("listDays on PostgreSQL", () => {
  // cites: REQ-016/AC-001, REQ-016/AC-004, REQ-016/AC-005
  it("lists one page of open and closed days, newest first, with next_before", async () => {
    expect((await app.inject({ method: "POST", url: "/days/2026-03-08/close" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/days/2026-03-05/close" })).statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: "/days?limit=6" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      first_day_of_use: "2026-03-01",
      items: [
        { date: "2026-03-10", state: "open", open_past: false, closed_at: null },
        { date: "2026-03-09", state: "open", open_past: true, closed_at: null },
        { date: "2026-03-08", state: "closed", open_past: false, closed_at: at.toISOString() },
        { date: "2026-03-07", state: "open", open_past: true, closed_at: null },
        { date: "2026-03-06", state: "open", open_past: true, closed_at: null },
        { date: "2026-03-05", state: "closed", open_past: false, closed_at: at.toISOString() },
      ],
      next_before: "2026-03-05",
    });
  });
});
