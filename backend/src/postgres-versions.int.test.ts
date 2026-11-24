import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import { PostgresProductStore } from "./postgres-store.js";
import { DuplicateProductError, NotSelectableError, type NewProduct } from "./products.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point at a test database");

const schema = `t_${randomUUID().replace(/-/g, "")}`;
const options = `-c search_path=${schema}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
let pool: pg.Pool;
let store: PostgresProductStore;
let n = 0;

const AT = new Date("2026-01-02T03:04:05.000Z");

function item(name: string, shop = "Shop A"): NewProduct {
  return { name, shop, calories: 250, protein: 10, fat: 5, source: "manual" };
}

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
  store = new PostgresProductStore(pool, () => `ver-${++n}`);
});

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

describe("migration 004: product versions and soft delete", () => {
  // cites: ADR-010/C-001
  it("leaves a product with no replacement and no deletion, so it is selectable", async () => {
    const p = await store.add(item("Product S"));
    expect((await store.get(p.id))?.state).toEqual({ replaced_by: null, deleted_at: null });
    expect(await store.findSelectable("Product S", "Shop A")).toEqual(p);
  });

  // cites: REQ-005/AC-016, R-003, R-006
  it("lets a new product share the name and shop of a soft-deleted one", async () => {
    const old = await store.add(item("Product B"));
    await store.softDelete(old.id, AT);
    const fresh = await store.add(item("product  b"));
    expect(fresh.id).not.toBe(old.id);
    expect((await store.get(old.id))?.state.deleted_at).toEqual(AT);
    expect(await store.findSelectable("Product B", "Shop A")).toEqual(fresh);
  });

  // cites: R-003, R-004
  it("lets a new product share the name and shop of a replaced version", async () => {
    const old = await store.add(item("Product C"));
    const next = await store.add(item("Product C next"));
    await pool.query("UPDATE products SET replaced_by = $2 WHERE id = $1", [old.id, next.id]);
    const fresh = await store.add(item("Product C"));
    expect(await store.findSelectable("Product C", "Shop A")).toEqual(fresh);
  });

  // cites: R-003
  it("still refuses two selectable products with the same name and shop", async () => {
    await store.add(item("Product D"));
    await expect(store.add(item(" PRODUCT d "))).rejects.toBeInstanceOf(DuplicateProductError);
  });

  // cites: ADR-010/C-001
  it("refuses a row that is both replaced and soft-deleted", async () => {
    const old = await store.add(item("Product X"));
    const next = await store.add(item("Product X next"));
    await expect(
      pool.query("UPDATE products SET replaced_by = $2, deleted_at = $3::timestamptz WHERE id = $1", [old.id, next.id, AT]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("PostgresProductStore state operations", () => {
  // cites: REQ-005/AC-011, R-006
  it("restores a soft-deleted product with its values unchanged", async () => {
    const p = await store.add(item("Product F"));
    await store.softDelete(p.id, AT);
    const restored = await store.restore(p.id);
    expect(restored).toEqual({ product: p, state: { replaced_by: null, deleted_at: null } });
    expect(await store.findSelectable("Product F", "Shop A")).toEqual(p);
  });

  // cites: REQ-005/AC-015, R-003, R-006
  it("refuses a restore that would duplicate a selectable product and leaves it deleted", async () => {
    const old = await store.add(item("Product E"));
    await store.softDelete(old.id, AT);
    const live = await store.add(item("Product E"));
    await expect(store.restore(old.id)).rejects.toBeInstanceOf(DuplicateProductError);
    expect((await store.get(old.id))?.state.deleted_at).toEqual(AT);
    expect(await store.findSelectable("Product E", "Shop A")).toEqual(live);
  });

  // cites: REQ-005/AC-004, R-006
  it("soft-deletes with the given time, keeps the row readable and returns an already deleted one unchanged", async () => {
    const p = await store.add(item("Product G"));
    const first = await store.softDelete(p.id, AT);
    expect(first?.state.deleted_at).toEqual(AT);
    const again = await store.softDelete(p.id, new Date("2027-01-01T00:00:00.000Z"));
    expect(again?.state.deleted_at).toEqual(AT);
    expect(await store.findSelectable("Product G", "Shop A")).toBeUndefined();
    expect((await store.get(p.id))?.product).toEqual(p);
  });

  // cites: IF-001@1.2.0#deleteProduct, IF-001@1.2.0#restoreProduct
  it("refuses to delete or restore a replaced product", async () => {
    const old = await store.add(item("Product H"));
    const next = await store.add(item("Product H next"));
    await pool.query("UPDATE products SET replaced_by = $2 WHERE id = $1", [old.id, next.id]);
    await expect(store.softDelete(old.id, AT)).rejects.toBeInstanceOf(NotSelectableError);
    await expect(store.restore(old.id)).rejects.toBeInstanceOf(NotSelectableError);
    expect((await store.get(old.id))?.state).toEqual({ replaced_by: next.id, deleted_at: null });
  });

  // cites: IF-001@1.2.0#getProduct
  it("returns undefined for an unknown id", async () => {
    expect(await store.get("no-such-id")).toBeUndefined();
    expect(await store.softDelete("no-such-id", AT)).toBeUndefined();
    expect(await store.restore("no-such-id")).toBeUndefined();
  });

  // cites: IF-001@1.2.0#listProducts
  it("lists selectable and deleted products by name then shop ignoring case, never replaced ones", async () => {
    const b = await store.add(item("Order b", "Shop O"));
    await store.add(item("order A", "Shop O"));
    const gone = await store.add(item("Order c", "Shop O"));
    const old = await store.add(item("Order d", "Shop O"));
    await store.softDelete(gone.id, AT);
    await pool.query("UPDATE products SET replaced_by = $2 WHERE id = $1", [old.id, b.id]);
    const inShop = (records: { product: { shop: string; name: string } }[]) =>
      records.filter((r) => r.product.shop === "Shop O").map((r) => r.product.name);
    expect(inShop(await store.listByState("selectable"))).toEqual(["order A", "Order b"]);
    expect(inShop(await store.listByState("deleted"))).toEqual(["Order c"]);
  });
});
