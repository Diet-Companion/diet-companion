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
  products = new PostgresProductStore(pool, () => `prod-${++n}`);
  dishes = new PostgresDishStore(pool, () => `dish-${++n}`);
});

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

describe("migration 005: dishes and dish lines", () => {
  // cites: REQ-006/AC-001, ADR-012/C-001
  it("saves a dish with its lines in display order and reads amounts back as numbers", async () => {
    const white = await products.add(item("Egg white"));
    const egg = await products.add(item("Egg", { piece_weight: 50 }));
    const saved = await dishes.add({ name: "omelette", lines: [grams(white.id, 100), pieces(egg.id, 2)] }, AT);
    expect(saved.state).toEqual({ replaced_by: null, deleted_at: null });
    expect(saved.dish.lines).toEqual([
      { position: 0, product_id: white.id, grams: 100, pieces: null },
      { position: 1, product_id: egg.id, grams: null, pieces: 2 },
    ]);
    expect(await dishes.get(saved.dish.id)).toEqual(saved);
  });

  // cites: REQ-006/AC-017, R-010
  it("saves two dishes with the same name", async () => {
    const p = await products.add(item("Dup product"));
    const a = await dishes.add({ name: "twin", lines: [grams(p.id, 10)] }, AT);
    const b = await dishes.add({ name: "twin", lines: [grams(p.id, 10)] }, AT);
    expect(b.dish.id).not.toBe(a.dish.id);
  });

  // cites: ADR-012/C-001, A-023
  it("refuses a line with both amounts, none, or an amount of 0 or less, and a blank name", async () => {
    const p = await products.add(item("Check product"));
    const d = await dishes.add({ name: "checks", lines: [grams(p.id, 1)] }, AT);
    const insertLine = (pos: number, g: number | null, pc: number | null) =>
      pool.query("INSERT INTO dish_lines (dish_id, position, product_id, grams, pieces) VALUES ($1, $2, $3, $4, $5)", [
        d.dish.id,
        pos,
        p.id,
        g,
        pc,
      ]);
    await expect(insertLine(5, 1, 1)).rejects.toMatchObject({ code: "23514" });
    await expect(insertLine(6, null, null)).rejects.toMatchObject({ code: "23514" });
    await expect(insertLine(7, 0, null)).rejects.toMatchObject({ code: "23514" });
    await expect(insertLine(8, null, -1)).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query("INSERT INTO dishes (id, name, created_at) VALUES ('blank-1', '  ', now())"),
    ).rejects.toMatchObject({ code: "23514" });
  });

  // cites: ADR-012/C-001
  it("refuses a dish row that is both replaced and soft-deleted", async () => {
    const p = await products.add(item("Both product"));
    const old = await dishes.add({ name: "both", lines: [grams(p.id, 1)] }, AT);
    const next = await dishes.add({ name: "both", lines: [grams(p.id, 2)] }, AT);
    await expect(
      pool.query("UPDATE dishes SET replaced_by = $2, deleted_at = $3::timestamptz WHERE id = $1", [old.dish.id, next.dish.id, AT]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  // cites: ADR-012/C-004, ADR-012/C-001
  it("saves nothing when a line names an unknown product", async () => {
    const p = await products.add(item("Atomic product"));
    await expect(
      dishes.add({ name: "atomic-dish", lines: [grams(p.id, 1), grams("no-such-product", 1)] }, AT),
    ).rejects.toMatchObject({ code: "23503" });
    const left = await pool.query("SELECT id FROM dishes WHERE name = 'atomic-dish'");
    expect(left.rowCount).toBe(0);
  });
});

describe("PostgresDishStore state operations", () => {
  // cites: REQ-006/AC-011, REQ-006/AC-012, R-010
  it("soft-deletes with the given time, keeps the dish readable and out of the selectable list", async () => {
    const p = await products.add(item("Del product"));
    const d = await dishes.add({ name: "del-dish", lines: [grams(p.id, 5)] }, AT);
    const first = await dishes.softDelete(d.dish.id, AT);
    expect(first?.state.deleted_at).toEqual(AT);
    const again = await dishes.softDelete(d.dish.id, new Date("2027-01-01T00:00:00.000Z"));
    expect(again?.state.deleted_at).toEqual(AT);
    expect((await dishes.get(d.dish.id))?.dish).toEqual(d.dish);
    const selectable = (await dishes.listByState("selectable")).map((r) => r.dish.id);
    const deleted = (await dishes.listByState("deleted")).map((r) => r.dish.id);
    expect(selectable).not.toContain(d.dish.id);
    expect(deleted).toContain(d.dish.id);
  });

  // cites: REQ-006/AC-016, A-010, R-010
  it("restores a soft-deleted dish with its lines unchanged", async () => {
    const p = await products.add(item("Restore product"));
    const d = await dishes.add({ name: "restore-dish", lines: [grams(p.id, 5), grams(p.id, 7)] }, AT);
    await dishes.softDelete(d.dish.id, AT);
    const restored = await dishes.restore(d.dish.id);
    expect(restored).toEqual(d);
    expect((await dishes.listByState("selectable")).map((r) => r.dish.id)).toContain(d.dish.id);
    expect(await dishes.restore(d.dish.id)).toEqual(d);
  });

  // cites: IF-001@1.3.0#deleteDish, IF-001@1.3.0#restoreDish
  it("refuses to delete or restore a replaced dish and never lists it", async () => {
    const p = await products.add(item("Replaced product"));
    const old = await dishes.add({ name: "replaced-old", lines: [grams(p.id, 1)] }, AT);
    const next = await dishes.add({ name: "replaced-new", lines: [grams(p.id, 2)] }, AT);
    await pool.query("UPDATE dishes SET replaced_by = $2 WHERE id = $1", [old.dish.id, next.dish.id]);
    await expect(dishes.softDelete(old.dish.id, AT)).rejects.toBeInstanceOf(DishNotSelectableError);
    await expect(dishes.restore(old.dish.id)).rejects.toBeInstanceOf(DishNotSelectableError);
    expect((await dishes.get(old.dish.id))?.state).toEqual({ replaced_by: next.dish.id, deleted_at: null });
    const ids = [...(await dishes.listByState("selectable")), ...(await dishes.listByState("deleted"))].map((r) => r.dish.id);
    expect(ids).not.toContain(old.dish.id);
  });

  // cites: IF-001@1.3.0#getDish
  it("returns undefined for an unknown id", async () => {
    expect(await dishes.get("no-such-dish")).toBeUndefined();
    expect(await dishes.softDelete("no-such-dish", AT)).toBeUndefined();
    expect(await dishes.restore("no-such-dish")).toBeUndefined();
  });

  // cites: IF-001@1.3.0#listDishes
  it("lists by name ignoring letter case, then by id", async () => {
    const p = await products.add(item("Order product"));
    const b = await dishes.add({ name: "Ord b", lines: [grams(p.id, 1)] }, AT);
    const a = await dishes.add({ name: "ord A", lines: [grams(p.id, 1)] }, AT);
    const mine = new Set([a.dish.id, b.dish.id]);
    const ids = (await dishes.listByState("selectable")).map((r) => r.dish.id).filter((id) => mine.has(id));
    expect(ids).toEqual([a.dish.id, b.dish.id]);
  });
});

describe("dish lines and product versions", () => {
  // cites: REQ-006/AC-015, R-009, ADR-012/C-005
  it("keeps the exact product id of a line after the product is replaced", async () => {
    const p = await products.add(item("Version product"));
    const d = await dishes.add({ name: "version-dish", lines: [grams(p.id, 30)] }, AT);
    const edit = await products.edit(p.id, { calories: 300 });
    expect(edit?.versioned).toBe(true);
    const line = (await dishes.get(d.dish.id))?.dish.lines[0];
    expect(line?.product_id).toBe(p.id);
    expect(line?.product_id).not.toBe(edit?.product.id);
    const old = await products.get(p.id);
    expect(old?.product.calories).toBe(250);
    expect(old?.state.replaced_by).toBe(edit?.product.id);
    expect((await dishes.get(d.dish.id))?.state).toEqual({ replaced_by: null, deleted_at: null });
  });

  // cites: REQ-006/AC-018, R-009, R-005
  it("shows a product renamed in place by the same product id", async () => {
    const p = await products.add(item("Product A"));
    const d = await dishes.add({ name: "rename-dish", lines: [grams(p.id, 40)] }, AT);
    const edit = await products.edit(p.id, { name: "Product B" });
    expect(edit?.versioned).toBe(false);
    const line = (await dishes.get(d.dish.id))?.dish.lines[0];
    expect(line).toMatchObject({ product_id: p.id, grams: 40 });
    expect((await products.get(line?.product_id ?? ""))?.product.name).toBe("Product B");
    const count = await pool.query("SELECT id FROM dishes WHERE name = 'rename-dish'");
    expect(count.rowCount).toBe(1);
  });
});
