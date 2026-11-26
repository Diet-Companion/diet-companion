import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import { PostgresTargetStore } from "./postgres-target-store.js";
import { rangesInForce } from "./targets.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point at a test database");

const schema = `t_${randomUUID().replace(/-/g, "")}`;
const options = `-c search_path=${schema}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
let pool: pg.Pool;
let store: PostgresTargetStore;

const row = (nutrient: "calories" | "protein" | "fat", minimum: number, maximum: number, effective_from: string) => ({
  nutrient,
  minimum,
  maximum,
  effective_from,
});

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
  store = new PostgresTargetStore(pool);
});

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

describe("migration 006: target ranges", () => {
  // cites: ADR-015/C-001
  it("creates the table with no rows", async () => {
    const count = await pool.query<{ n: string }>("SELECT count(*) AS n FROM target_ranges");
    expect(count.rows[0]?.n).toBe("0");
  });

  // cites: REQ-009/AC-008, ADR-015/C-001
  it("refuses a nutrient other than calories, protein and fat", async () => {
    await expect(store.save(row("salt" as "fat", 1, 2, "2026-01-01"))).rejects.toThrow();
  });

  // cites: R-011, ADR-015/C-001
  it("refuses a negative minimum and a maximum below the minimum, and accepts equal limits and 0", async () => {
    await expect(store.save(row("fat", -1, 70, "2026-01-02"))).rejects.toThrow();
    await expect(store.save(row("fat", 80, 70, "2026-01-02"))).rejects.toThrow();
    expect(await store.save(row("fat", 70, 70, "2026-01-02"))).toEqual(row("fat", 70, 70, "2026-01-02"));
    expect(await store.save(row("fat", 0, 70, "2026-01-03"))).toEqual(row("fat", 0, 70, "2026-01-03"));
  });

  // cites: REQ-009/AC-005, REQ-009/AC-006, A-033, ADR-015/C-002
  it("overwrites the row of the same day and leaves earlier rows alone", async () => {
    await store.save(row("calories", 1800, 2200, "2026-02-01"));
    await store.save(row("calories", 1900, 2300, "2026-02-05"));
    await store.save(row("calories", 2000, 2400, "2026-02-05"));
    const rows = await pool.query("SELECT minimum, maximum FROM target_ranges WHERE nutrient = 'calories' ORDER BY effective_from");
    expect(rows.rows).toEqual([
      { minimum: 1800, maximum: 2200 },
      { minimum: 2000, maximum: 2400 },
    ]);
  });

  // cites: REQ-009/AC-005, REQ-009/AC-006, ADR-015/C-003
  it("reads the range in force by date", async () => {
    const before = await rangesInForce(store, "2026-02-04");
    const from = await rangesInForce(store, "2026-02-05");
    const later = await rangesInForce(store, "2026-03-01");
    expect(before.calories).toMatchObject({ minimum: 1800, maximum: 2200, effective_from: "2026-02-01" });
    expect(from.calories).toMatchObject({ minimum: 2000, maximum: 2400, effective_from: "2026-02-05" });
    expect(later.calories).toMatchObject({ minimum: 2000, maximum: 2400 });
    expect((await rangesInForce(store, "2026-01-31")).calories).toBeNull();
    expect(from.protein).toBeNull();
  });
});
