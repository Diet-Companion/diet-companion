import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import { PostgresDishStore } from "./postgres-dish-store.js";
import { PostgresPlanStore } from "./postgres-plan-store.js";
import { PostgresProductStore } from "./postgres-store.js";
import { DayClosedError, type NewStoredEntry } from "./plan-store.js";

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
});

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

async function newProduct(pieceWeight?: number) {
  return products.add({
    name: `Test product ${randomUUID()}`,
    shop: "Test shop",
    calories: 100,
    protein: 10,
    fat: 5,
    source: "manual",
    ...(pieceWeight === undefined ? {} : { piece_weight: pieceWeight }),
  });
}

async function newDish(productId: string) {
  return dishes.add({ name: "Test dish", lines: [{ product_id: productId, grams: 100, pieces: null }] }, at);
}

const productEntry = (productId: string, meal: NewStoredEntry["meal"] = "lunch", grams: number | null = 100): NewStoredEntry => ({
  meal,
  product_id: productId,
  dish_id: null,
  grams,
  pieces: grams === null ? 1 : null,
  from_dish_id: null,
});

describe("migration 007: days and day entries", () => {
  // cites: ADR-019/C-001
  it("creates both tables empty", async () => {
    const days = await pool.query<{ n: string }>("SELECT count(*) AS n FROM days");
    const entries = await pool.query<{ n: string }>("SELECT count(*) AS n FROM day_entries");
    expect([days.rows[0]?.n, entries.rows[0]?.n]).toEqual(["0", "0"]);
  });

  // cites: ADR-017/C-001, R-007
  it("refuses rows that break the checks of the entry table", async () => {
    const product = await newProduct();
    const dish = await newDish(product.id);
    await pool.query("INSERT INTO days (day, created_at) VALUES ('2026-04-01', now())");
    const insert = (kind: string, meal: string, position: number, productId: string | null, dishId: string | null, grams: number | null, pieces: number | null, fromDish: string | null = null) =>
      pool.query(
        "INSERT INTO day_entries (id, kind, day, meal, position, product_id, dish_id, grams, pieces, from_dish_id, created_at) VALUES ($1, $2, '2026-04-01', $3, $4, $5, $6, $7, $8, $9, now())",
        [randomUUID(), kind, meal, position, productId, dishId, grams, pieces, fromDish],
      );
    await expect(insert("plan", "lunch", 0, product.id, null, 100, null)).resolves.toBeDefined();
    await expect(insert("plan", "lunch", 1, null, null, null, null)).rejects.toThrow();
    await expect(insert("plan", "lunch", 2, product.id, dish.dish.id, 100, null)).rejects.toThrow();
    await expect(insert("plan", "lunch", 3, product.id, null, 100, 2)).rejects.toThrow();
    await expect(insert("plan", "lunch", 4, product.id, null, null, null)).rejects.toThrow();
    await expect(insert("plan", "lunch", 5, product.id, null, 0, null)).rejects.toThrow();
    await expect(insert("plan", "lunch", 6, null, dish.dish.id, 100, null)).rejects.toThrow();
    await expect(insert("plan", "lunch", 7, null, dish.dish.id, null, null, dish.dish.id)).rejects.toThrow();
    await expect(insert("plan", "lunch", 8, null, dish.dish.id, null, null)).resolves.toBeDefined();
    await expect(insert("plan", "snack", 9, product.id, null, 100, null)).rejects.toThrow();
    await expect(insert("diary", "lunch", 10, product.id, null, 100, null)).rejects.toThrow();
    await expect(insert("plan", "lunch", 0, product.id, null, 50, null)).rejects.toThrow();
    await expect(insert("log", "lunch", 0, product.id, null, 50, null)).resolves.toBeDefined();
  });
});

describe("PostgresPlanStore", () => {
  // cites: ADR-019/C-001, ADR-017/C-002
  it("makes the day row on first use, once, and gives entries the next position of their meal", async () => {
    const product = await newProduct();
    const first = await plan.mutate("2026-05-01", at, (tx) => tx.add(productEntry(product.id)));
    const second = await plan.mutate("2026-05-01", at, (tx) => tx.add(productEntry(product.id, "lunch", 200)));
    const other = await plan.mutate("2026-05-01", at, (tx) => tx.add(productEntry(product.id, "dinner")));
    expect([first.position, second.position, other.position]).toEqual([0, 1, 0]);
    const days = await pool.query<{ closed_at: Date | null }>("SELECT closed_at FROM days WHERE day = '2026-05-01'");
    expect(days.rows).toEqual([{ closed_at: null }]);
    const read = await plan.read("2026-05-01");
    expect(read.closed).toBe(false);
    expect(read.entries.map((e) => e.id)).toEqual([first.id, second.id, other.id]);
  });

  // cites: REQ-013/AC-006, ADR-017/C-004
  it("rolls back the entry and the day row when the work throws", async () => {
    const product = await newProduct();
    await expect(
      plan.mutate("2026-05-02", at, async (tx) => {
        await tx.add(productEntry(product.id));
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    const days = await pool.query("SELECT 1 FROM days WHERE day = '2026-05-02'");
    expect(days.rowCount).toBe(0);
    expect((await plan.read("2026-05-02")).entries).toEqual([]);
  });

  // cites: REQ-013/AC-007, ADR-019/C-002
  it("refuses every change of a seeded closed day and still reads it", async () => {
    const product = await newProduct();
    const added = await plan.mutate("2026-05-03", at, (tx) => tx.add(productEntry(product.id)));
    await pool.query("UPDATE days SET closed_at = now() WHERE day = '2026-05-03'");
    let ran = false;
    const refused = (work: Parameters<typeof plan.mutate>[2]) => plan.mutate("2026-05-03", at, async (tx) => {
      ran = true;
      return work(tx);
    });
    await expect(refused((tx) => tx.add(productEntry(product.id, "dinner")))).rejects.toBeInstanceOf(DayClosedError);
    await expect(refused((tx) => tx.setAmount(added.id, { grams: 5, pieces: null }))).rejects.toBeInstanceOf(DayClosedError);
    await expect(refused((tx) => tx.remove(added.id))).rejects.toBeInstanceOf(DayClosedError);
    expect(ran).toBe(false);
    const read = await plan.read("2026-05-03");
    expect(read.closed).toBe(true);
    expect(read.entries).toEqual([added]);
  });

  // cites: REQ-013/AC-007, ADR-019/C-002
  it("holds the day row lock until the first change ends", async () => {
    const product = await newProduct();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let secondStarted = false;
    const first = plan.mutate("2026-05-04", at, async (tx) => {
      await tx.add(productEntry(product.id));
      await gate;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = plan.mutate("2026-05-04", at, async (tx) => {
      secondStarted = true;
      return tx.add(productEntry(product.id, "dinner"));
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(secondStarted).toBe(false);
    release();
    await first;
    await second;
    expect(secondStarted).toBe(true);
    expect((await plan.read("2026-05-04")).entries).toHaveLength(2);
  });

  // cites: REQ-013/AC-001, ADR-017/C-003, ADR-014
  it("keeps the exact ids of a replaced product and a deleted dish, and still changes the amount", async () => {
    const product = await newProduct(50);
    const dish = await newDish(product.id);
    const productEntryRow = await plan.mutate("2026-05-05", at, (tx) => tx.add(productEntry(product.id)));
    const dishEntryRow = await plan.mutate("2026-05-05", at, (tx) =>
      tx.add({ meal: "breakfast", product_id: null, dish_id: dish.dish.id, grams: null, pieces: null, from_dish_id: null }),
    );

    const edited = await products.edit(product.id, { calories: 250 });
    expect(edited?.versioned).toBe(true);
    await dishes.softDelete(dish.dish.id, at);

    const read = await plan.read("2026-05-05");
    expect(read.entries.map((e) => [e.id, e.product_id, e.dish_id])).toEqual([
      [dishEntryRow.id, null, dish.dish.id],
      [productEntryRow.id, product.id, null],
    ]);
    const changed = await plan.mutate("2026-05-05", at, (tx) => tx.setAmount(productEntryRow.id, { grams: null, pieces: 3 }));
    expect(changed).toMatchObject({ id: productEntryRow.id, product_id: product.id, grams: null, pieces: 3 });
  });
});
