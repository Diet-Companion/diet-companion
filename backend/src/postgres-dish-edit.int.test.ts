import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DishNotSelectableError, type NewDishLine } from "./dish-store.js";
import { runMigrations } from "./migrate.js";
import { PostgresDishStore } from "./postgres-dish-store.js";
import { PostgresProductStore } from "./postgres-store.js";
import type { NewProduct } from "./products.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point at a test database");

const schema = `t_${randomUUID().replace(/-/g, "")}`;
const options = `-c search_path=${schema}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
let pool: pg.Pool;
let products: PostgresProductStore;
let dishes: PostgresDishStore;
let n = 0;

const AT = new Date("2026-01-02T03:04:05.000Z");
const LATER = new Date("2026-01-03T03:04:05.000Z");

function item(name: string, extra: Partial<NewProduct> = {}): NewProduct {
  return { name, shop: "Shop A", calories: 250, protein: 10, fat: 5, source: "manual", ...extra };
}

const grams = (product_id: string, amount: number): NewDishLine => ({ product_id, grams: amount, pieces: null });
const pieces = (product_id: string, amount: number): NewDishLine => ({ product_id, grams: null, pieces: amount });

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
  products = new PostgresProductStore(pool, () => `eprod-${++n}`);
  dishes = new PostgresDishStore(pool, () => `edish-${++n}`);
});

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

async function seed() {
  const white = await products.add(item(`Egg white ${++n}`));
  const egg = await products.add(item(`Egg ${++n}`, { piece_weight: 50 }));
  const dish = await dishes.add({ name: "omelette", lines: [grams(white.id, 100), pieces(egg.id, 2)] }, AT);
  return { white, egg, dish };
}

describe("editDish on PostgreSQL", () => {
  // cites: REQ-006/AC-009, R-008
  it("records the new dish and sets replaced_by on the old one in one transaction, old lines unchanged", async () => {
    const { white, egg, dish } = await seed();
    const out = await dishes.edit(dish.dish.id, { lines: [grams(white.id, 150), pieces(egg.id, 2)] }, LATER);
    expect(out?.versioned).toBe(true);
    expect(out?.replaced_id).toBe(dish.dish.id);
    expect(out?.record.dish.id).not.toBe(dish.dish.id);
    expect(out?.record.dish.lines).toEqual([
      { position: 0, product_id: white.id, grams: 150, pieces: null },
      { position: 1, product_id: egg.id, grams: null, pieces: 2 },
    ]);
    const old = await dishes.get(dish.dish.id);
    expect(old?.state).toEqual({ replaced_by: out?.record.dish.id, deleted_at: null });
    expect(old?.dish).toEqual(dish.dish);
    const created = await pool.query("SELECT created_at FROM dishes WHERE id = $1", [out?.record.dish.id]);
    expect(created.rows[0].created_at).toEqual(LATER);
  });

  // cites: REQ-006/AC-010, R-008
  it("lists only the new dish as selectable and still reads the old one by id", async () => {
    const { white, dish } = await seed();
    const out = await dishes.edit(dish.dish.id, { lines: [grams(white.id, 7)] }, LATER);
    const selectable = (await dishes.listByState("selectable")).map((r) => r.dish.id);
    expect(selectable).toContain(out?.record.dish.id);
    expect(selectable).not.toContain(dish.dish.id);
    expect((await dishes.get(dish.dish.id))?.dish.lines).toHaveLength(2);
  });

  // cites: R-008
  it("applies a name-only change in place and records nothing for no change", async () => {
    const { dish } = await seed();
    const renamed = await dishes.edit(dish.dish.id, { name: "renamed" }, LATER);
    expect(renamed).toMatchObject({ versioned: false, replaced_id: null });
    expect(renamed?.record.dish).toEqual({ ...dish.dish, name: "renamed" });
    const before = await pool.query("SELECT count(*)::int AS c FROM dishes");
    const same = await dishes.edit(dish.dish.id, { name: "renamed", lines: dish.dish.lines }, LATER);
    expect(same?.versioned).toBe(false);
    const after = await pool.query("SELECT count(*)::int AS c FROM dishes");
    expect(after.rows[0].c).toBe(before.rows[0].c);
  });

  // cites: IF-001@1.3.0#editDish, ADR-012/C-004
  it("rolls everything back when the new lines fail, leaving the old dish selectable", async () => {
    const { white, dish } = await seed();
    const before = await pool.query("SELECT count(*)::int AS c FROM dishes");
    await expect(
      dishes.edit(dish.dish.id, { lines: [grams(white.id, 5), grams("no-such-product", 5)] }, LATER),
    ).rejects.toMatchObject({ code: "23503" });
    expect((await dishes.get(dish.dish.id))?.state).toEqual({ replaced_by: null, deleted_at: null });
    const after = await pool.query("SELECT count(*)::int AS c FROM dishes");
    expect(after.rows[0].c).toBe(before.rows[0].c);
  });

  // cites: IF-001@1.3.0#editDish
  it("throws for a replaced or deleted dish and returns undefined for an unknown id", async () => {
    const { white, dish } = await seed();
    await dishes.edit(dish.dish.id, { lines: [grams(white.id, 9)] }, LATER);
    await expect(dishes.edit(dish.dish.id, { name: "x" }, LATER)).rejects.toBeInstanceOf(DishNotSelectableError);
    const other = await seed();
    await dishes.softDelete(other.dish.dish.id, LATER);
    await expect(dishes.edit(other.dish.dish.id, { name: "x" }, LATER)).rejects.toBeInstanceOf(DishNotSelectableError);
    expect(await dishes.edit("edish-unknown", { name: "x" }, LATER)).toBeUndefined();
  });

  // cites: R-008, ADR-013
  it("lets one of two concurrent edits win under the row lock and refuses the other", async () => {
    const { white, egg, dish } = await seed();
    const results = await Promise.allSettled([
      dishes.edit(dish.dish.id, { lines: [grams(white.id, 11)] }, LATER),
      dishes.edit(dish.dish.id, { lines: [pieces(egg.id, 3)] }, LATER),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed && failed.status === "rejected" ? failed.reason : undefined).toBeInstanceOf(DishNotSelectableError);
    const old = await dishes.get(dish.dish.id);
    expect(old?.state.replaced_by).not.toBeNull();
  });
});
