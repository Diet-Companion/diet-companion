import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { runMigrations } from "./migrate.js";
import { PostgresDishStore } from "./postgres-dish-store.js";
import { PostgresPlanStore } from "./postgres-plan-store.js";
import { PostgresProductStore } from "./postgres-store.js";
import type { EntryKind, NewStoredEntry, PlanStore, PlanTx } from "./plan-store.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point at a test database");

const schema = `t_${randomUUID().replace(/-/g, "")}`;
const options = `-c search_path=${schema}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
let pool: pg.Pool;
let plan: PostgresPlanStore;
let products: PostgresProductStore;
let dishes: PostgresDishStore;
const at = new Date("2026-03-10T10:00:00Z");

/** The real store, except that the add number `failOn` of a change throws (0: never). */
class FailingPlanStore implements PlanStore {
  failOn = 0;
  constructor(private readonly inner: PlanStore) {}

  read(day: string, kind?: EntryKind) {
    return this.inner.read(day, kind);
  }

  mutate<T>(day: string, when: Date, work: (tx: PlanTx) => Promise<T>, kind?: EntryKind): Promise<T> {
    return this.inner.mutate(
      day,
      when,
      (tx) => {
        let adds = 0;
        const wrapped: PlanTx = {
          ...tx,
          add: async (entry: NewStoredEntry) => {
            adds += 1;
            if (this.failOn > 0 && adds === this.failOn) throw new Error("forced failure of the last write");
            return tx.add(entry);
          },
        };
        return work(wrapped);
      },
      kind,
    );
  }
}

let failing: FailingPlanStore;
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
  pool = new pg.Pool({ connectionString: url, options, max: 6 });
  plan = new PostgresPlanStore(pool, randomUUID);
  products = new PostgresProductStore(pool, randomUUID);
  dishes = new PostgresDishStore(pool, randomUUID);
  failing = new FailingPlanStore(plan);
  app = buildApp({
    store: products,
    dishStore: dishes,
    planStore: failing,
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

async function newProduct() {
  return products.add({
    name: `Test product ${randomUUID()}`,
    shop: "Test shop",
    calories: 100,
    protein: 10,
    fat: 5,
    source: "manual",
  });
}

/** A meal with three plan rows, written straight to the plan store. */
async function planThreeRows(day: string) {
  const ids = [await newProduct(), await newProduct(), await newProduct()];
  for (const [i, product] of ids.entries()) {
    await plan.mutate(day, at, (tx) =>
      tx.add({ meal: "lunch", product_id: product.id, dish_id: null, grams: 100 + i, pieces: null, from_dish_id: null }),
    );
  }
  return ids;
}

async function threeLineDish() {
  const ids = [await newProduct(), await newProduct(), await newProduct()];
  const created = await dishes.add(
    { name: "Test dish", lines: ids.map((p, i) => ({ product_id: p.id, grams: 50 + i, pieces: null })) },
    at,
  );
  return { ids, dishId: created.dish.id };
}

const confirm = (day: string) => app.inject({ method: "POST", url: `/days/${day}/log/meals/lunch/confirm` });
const split = (day: string, dishId: string) =>
  app.inject({ method: "POST", url: `/days/${day}/log/dish-products`, payload: { meal: "dinner", dish_id: dishId } });

describe("the log on PostgreSQL: all or none", () => {
  // cites: REQ-014/AC-001, ADR-017/C-004
  it("confirmMealAsPlanned saves no log row when the write of the last row fails", async () => {
    const day = "2026-03-01";
    await planThreeRows(day);
    failing.failOn = 3;
    try {
      const res = await confirm(day);
      expect(res.statusCode).toBe(500);
    } finally {
      failing.failOn = 0;
    }
    expect((await plan.read(day, "log")).entries).toEqual([]);
    expect((await plan.read(day)).entries).toHaveLength(3);
  });

  // cites: REQ-014/AC-010, ADR-018, ADR-017/C-004
  it("addLogDishProducts saves no log row and no day row when the write of the last line fails", async () => {
    const day = "2026-03-02";
    const { dishId } = await threeLineDish();
    failing.failOn = 3;
    try {
      const res = await split(day, dishId);
      expect(res.statusCode).toBe(500);
    } finally {
      failing.failOn = 0;
    }
    expect((await plan.read(day, "log")).entries).toEqual([]);
    const days = await pool.query("SELECT 1 FROM days WHERE day = $1::date", [day]);
    expect(days.rowCount).toBe(0);
  });

  // cites: REQ-014/AC-001, REQ-014/AC-010
  it("without the forced failure each writes all its rows in order", async () => {
    const confirmDay = "2026-03-03";
    const planned = await planThreeRows(confirmDay);
    const confirmed = await confirm(confirmDay);
    expect(confirmed.statusCode).toBe(201);
    const confirmedRows = (await plan.read(confirmDay, "log")).entries;
    expect(confirmedRows.map((e) => [e.product_id, e.position, e.grams])).toEqual(
      planned.map((p, i) => [p.id, i, 100 + i]),
    );

    const splitDay = "2026-03-04";
    const { ids, dishId } = await threeLineDish();
    const split3 = await split(splitDay, dishId);
    expect(split3.statusCode).toBe(201);
    const splitRows = (await plan.read(splitDay, "log")).entries;
    expect(splitRows.map((e) => [e.product_id, e.position, e.grams, e.from_dish_id])).toEqual(
      ids.map((p, i) => [p.id, i, 50 + i, dishId]),
    );
  });
});
