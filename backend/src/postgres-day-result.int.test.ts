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
let products: PostgresProductStore;
let targets: PostgresTargetStore;
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
  products = new PostgresProductStore(pool, randomUUID);
  targets = new PostgresTargetStore(pool);
  await targets.save({ nutrient: "calories", minimum: 1800, maximum: 2200, effective_from: "2026-03-01" });
  app = buildApp({
    store: products,
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

interface Sheet {
  closed: boolean;
  result: {
    ranges_source: string;
    nutrients: { nutrient: string; total: number; minimum: number | null; maximum: number | null; status: string }[];
  };
}

describe("the result of a closed day on PostgreSQL", () => {
  // cites: REQ-010/AC-014
  it("still uses the day_ranges rows of the closed day after the ranges change", async () => {
    const rice = await products.add({
      name: `Test product ${randomUUID()}`,
      shop: "Shop A",
      calories: 100,
      protein: 1,
      fat: 1,
      source: "manual",
    });
    const added = await app.inject({
      method: "POST",
      url: "/days/2026-03-04/log/entries",
      payload: { meal: "lunch", product_id: rice.id, grams: 100 },
    });
    expect(added.statusCode).toBe(201);
    const closing = await app.inject({ method: "POST", url: "/days/2026-03-04/close" });
    expect(closing.statusCode).toBe(200);
    const first = closing.json() as Sheet;
    expect(first.result.ranges_source).toBe("closed_copy");
    expect(first.result.nutrients[0]).toMatchObject({ total: 100, minimum: 1800, maximum: 2200, status: "yellow" });

    await targets.save({ nutrient: "calories", minimum: 50, maximum: 60, effective_from: "2026-03-01" });
    expect((await targets.rangeInForce("calories", "2026-03-04"))?.minimum).toBe(50);

    for (const kind of ["log", "plan"]) {
      const again = (await app.inject({ method: "GET", url: `/days/2026-03-04/${kind}` })).json() as Sheet;
      expect(again.closed).toBe(true);
      expect(again.result.ranges_source).toBe("closed_copy");
      expect(again.result.nutrients[0]).toMatchObject({ minimum: 1800, maximum: 2200 });
    }
    const log = (await app.inject({ method: "GET", url: "/days/2026-03-04/log" })).json() as Sheet;
    expect(log.result).toEqual(first.result);
  });
});
