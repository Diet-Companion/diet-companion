import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { runMigrations } from "./migrate.js";
import { PostgresTargetStore } from "./postgres-target-store.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point at a test database");

const schema = `t_${randomUUID().replace(/-/g, "")}`;
const options = `-c search_path=${schema}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
let pool: pg.Pool;
let app: ReturnType<typeof buildApp>;

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
  app = buildApp({
    targetStore: new PostgresTargetStore(pool),
    isOwner: () => true,
    clock: () => new Date("2026-01-15T10:00:00.000Z"),
    timeZone: "Europe/Rome",
  });
});

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

describe("setTargetRange on PostgreSQL", () => {
  // cites: REQ-009/AC-002, REQ-009/AC-010, R-011
  it("leaves target_ranges unchanged after every refused save", async () => {
    const saved = await app.inject({ method: "PUT", url: "/target-ranges/calories", payload: { minimum: 1800, maximum: 2200 } });
    expect(saved.statusCode).toBe(200);
    const snapshot = "SELECT nutrient, minimum, maximum, effective_from::text AS effective_from FROM target_ranges ORDER BY nutrient, effective_from";
    const before = await pool.query(snapshot);
    const refused: Array<[string, object]> = [
      ["calories", { minimum: 2000, maximum: 1800 }],
      ["calories", { minimum: 1800 }],
      ["calories", { minimum: -1, maximum: 2200 }],
      ["calories", { minimum: 1800, maximum: 2200.5 }],
      ["calories", { minimum: 1800, maximum: 2147483648 }],
      ["salt", { minimum: 1, maximum: 2 }],
    ];
    for (const [nutrient, payload] of refused) {
      const res = await app.inject({ method: "PUT", url: `/target-ranges/${nutrient}`, payload });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    }
    const after = await pool.query(snapshot);
    expect(after.rows).toEqual(before.rows);
    expect(after.rows).toHaveLength(1);
  });
});
