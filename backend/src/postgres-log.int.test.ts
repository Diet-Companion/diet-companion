import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { runMigrations } from "./migrate.js";
import { PostgresDishStore } from "./postgres-dish-store.js";
import { PostgresPlanStore } from "./postgres-plan-store.js";
import { PostgresProductStore } from "./postgres-store.js";
import type { EntryKind, PlanStore, PlanTx } from "./plan-store.js";

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
// Noon in Rome on 2026-01-15: today is 2026-01-15.
const NOON = new Date("2026-01-15T11:00:00.000Z");

/** Wraps the Postgres plan store and makes the nth add of a change throw, so the last row of a change fails. */
class FailingPlanStore implements PlanStore {
  failOnAdd = 0;

  constructor(private readonly inner: PlanStore) {}

  read(day: string, kind?: EntryKind) {
    return this.inner.read(day, kind);
  }

  mutate<T>(day: string, when: Date, work: (tx: PlanTx) => Promise<T>, kind?: EntryKind): Promise<T> {
    const failOn = this.failOnAdd;
    return this.inner.mutate(
      day,
      when,
      (tx) => {
        let adds = 0;
        const wrapped: PlanTx = {
          add: async (entry) => {
            adds += 1;
            if (adds === failOn) throw new Error("forced failure on the last row");
            return tx.add(entry);
          },
          find: (id) => tx.find(id),
          setAmount: (id, amount) => tx.setAmount(id, amount),
          remove: (id) => tx.remove(id),
          list: (meal, listKind) => tx.list(meal, listKind),
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
    clock: () => NOON,
    timeZone: "Europe/Rome",
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

describe("all rows or none in the log", () => {
  // cites: REQ-014/AC-001, ADR-017/C-004, IF-001@1.5.0#confirmMealAsPlanned
  it("confirmMealAsPlanned saves no row when the last row fails, and all rows when nothing fails", async () => {
    const day = "2026-01-11";
    const rice = await newProduct();
    const chicken = await newProduct();
    await plan.mutate(day, at, (tx) => tx.add({ meal: "lunch", product_id: rice.id, dish_id: null, grams: 100, pieces: null, from_dish_id: null }));
    await plan.mutate(day, at, (tx) => tx.add({ meal: "lunch", product_id: chicken.id, dish_id: null, grams: 150, pieces: null, from_dish_id: null }));

    failing.failOnAdd = 2;
    const failed = await app.inject({ method: "POST", url: `/days/${day}/log/meals/lunch/confirm` });
    expect(failed.statusCode).toBe(500);
    expect((await plan.read(day, "log")).entries).toHaveLength(0);

    failing.failOnAdd = 0;
    const saved = await app.inject({ method: "POST", url: `/days/${day}/log/meals/lunch/confirm` });
    expect(saved.statusCode).toBe(201);
    expect((await plan.read(day, "log")).entries.map((e) => [e.product_id, e.grams])).toEqual([
      [rice.id, 100],
      [chicken.id, 150],
    ]);
  });

  // cites: REQ-014/AC-010, ADR-017/C-004, ADR-018/C-001, IF-001@1.5.0#addLogDishProducts
  it("addLogDishProducts saves no row when the last row fails, and all rows in dish order when nothing fails", async () => {
    const day = "2026-01-12";
    const white = await newProduct();
    const egg = await newProduct();
    const dish = await dishes.add(
      {
        name: "Test omelette",
        lines: [
          { product_id: white.id, grams: 100, pieces: null },
          { product_id: egg.id, grams: 120, pieces: null },
        ],
      },
      at,
    );
    const payload = { meal: "dinner", dish_id: dish.dish.id, lines: [{ position: 0, grams: 150 }] };

    failing.failOnAdd = 2;
    const failed = await app.inject({ method: "POST", url: `/days/${day}/log/dish-products`, payload });
    expect(failed.statusCode).toBe(500);
    expect((await plan.read(day, "log")).entries).toHaveLength(0);

    failing.failOnAdd = 0;
    const saved = await app.inject({ method: "POST", url: `/days/${day}/log/dish-products`, payload });
    expect(saved.statusCode).toBe(201);
    const rows = (await plan.read(day, "log")).entries;
    expect(rows.map((e) => [e.product_id, e.grams, e.from_dish_id])).toEqual([
      [white.id, 150, dish.dish.id],
      [egg.id, 120, dish.dish.id],
    ]);
    const stored = await dishes.get(dish.dish.id);
    expect(stored?.dish.lines.map((l) => l.grams)).toEqual([100, 120]);
  });
});
