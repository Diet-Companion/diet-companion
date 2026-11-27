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
let plan: PostgresPlanStore;
let products: PostgresProductStore;
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
  pool = new pg.Pool({ connectionString: url, options, max: 6 });
  plan = new PostgresPlanStore(pool, randomUUID);
  products = new PostgresProductStore(pool, randomUUID);
  const targets = new PostgresTargetStore(pool);
  await targets.save({ nutrient: "calories", minimum: 1800, maximum: 2200, effective_from: "2026-03-01" });
  await targets.save({ nutrient: "protein", minimum: 90, maximum: 120, effective_from: "2026-03-01" });
  await targets.save({ nutrient: "calories", minimum: 2000, maximum: 2500, effective_from: "2026-03-09" });
  app = buildApp({
    store: products,
    dishStore: new PostgresDishStore(pool, randomUUID),
    targetStore: targets,
    planStore: plan,
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

const close = (date: string) => app.inject({ method: "POST", url: `/days/${date}/close` });
const count = async (sql: string, params: unknown[]): Promise<number> =>
  (await pool.query<{ n: number }>(sql, params)).rows[0]?.n ?? -1;

describe("closeDay on PostgreSQL", () => {
  // cites: REQ-011/AC-001
  it("stores the ranges in force on the date and sets closed_at from the clock", async () => {
    const res = await close("2026-03-05");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ date: "2026-03-05", closed: true, closed_at: at.toISOString() });
    expect(await plan.closedRanges("2026-03-05")).toEqual([
      { nutrient: "calories", minimum: 1800, maximum: 2200 },
      { nutrient: "protein", minimum: 90, maximum: 120 },
    ]);
    expect(await plan.closedAt("2026-03-05")).toEqual(at);
  });

  // cites: REQ-016/AC-002
  it("refuses a second close with day.closed and writes no second set of ranges", async () => {
    expect((await close("2026-03-06")).statusCode).toBe(200);
    const again = await close("2026-03-06");
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("day.closed");
    expect(await count("SELECT count(*)::int AS n FROM day_ranges WHERE day = $1::date", ["2026-03-06"])).toBe(2);
  });

  // cites: REQ-016/AC-002
  it("lets exactly one of two simultaneous closes succeed", async () => {
    const results = await Promise.all([close("2026-03-07"), close("2026-03-07")]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await count("SELECT count(*)::int AS n FROM day_ranges WHERE day = $1::date", ["2026-03-07"])).toBe(2);
  });

  // cites: IF-001@1.6.0#closeDay
  it("saves nothing, not even a day row, when the ranges cannot be resolved", async () => {
    await expect(
      plan.closeDay("2026-03-08", at, async () => {
        throw new Error("forced failure of the ranges");
      }),
    ).rejects.toThrow("forced failure of the ranges");
    expect(await count("SELECT count(*)::int AS n FROM days WHERE day = $1::date", ["2026-03-08"])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM day_ranges WHERE day = $1::date", ["2026-03-08"])).toBe(0);
  });

  // cites: REQ-013/AC-007, REQ-014/AC-011
  it("refuses a plan write and a log write after the day was closed", async () => {
    const rice = await products.add({
      name: `Test product ${randomUUID()}`,
      shop: "Shop A",
      calories: 100,
      protein: 1,
      fat: 1,
      source: "manual",
    });
    expect((await close("2026-03-10")).statusCode).toBe(200);
    const entry = { meal: "lunch", product_id: rice.id, grams: 100 };
    const planned = await app.inject({ method: "POST", url: "/days/2026-03-10/plan/entries", payload: entry });
    const logged = await app.inject({ method: "POST", url: "/days/2026-03-10/log/entries", payload: entry });
    expect(planned.statusCode).toBe(409);
    expect(planned.json().code).toBe("day.closed");
    expect(logged.statusCode).toBe(409);
    expect(logged.json().code).toBe("day.closed");
    expect(await count("SELECT count(*)::int AS n FROM day_entries WHERE day = $1::date", ["2026-03-10"])).toBe(0);
  });

  // cites: REQ-011/AC-004
  it("lists the open days before a date, oldest first, from the first day of use", async () => {
    expect((await close("2026-03-02")).statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: "/days/open?before=2026-03-04" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ first_day_of_use: "2026-03-01", before: "2026-03-04", days: ["2026-03-01", "2026-03-03"] });
  });
});
