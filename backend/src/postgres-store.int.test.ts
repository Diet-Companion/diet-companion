import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import { PostgresProductStore } from "./postgres-store.js";
import { DuplicateProductError, type NewProduct } from "./products.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point at a test database");

const schema = `t_${randomUUID().replace(/-/g, "")}`;
const options = `-c search_path=${schema}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
let pool: pg.Pool;
let store: PostgresProductStore;
let n = 0;

const PRODUCT_A: NewProduct = {
  name: "Product A",
  shop: "Shop A",
  calories: 250,
  protein: 10,
  fat: 5,
  brand: "Brand X",
  source: "label",
};

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
  store = new PostgresProductStore(pool, () => `id-${++n}`);
});

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

describe("PostgresProductStore", () => {
  // cites: REQ-003/AC-010, R-002
  it("saves a product with source label when no selectable product has the name and shop", async () => {
    const saved = await store.add({ ...PRODUCT_A, name: "Product Z", shop: "Shop Z" });
    expect(saved.source).toBe("label");
    expect(saved.id).toMatch(/^id-/);
    expect(await store.findSelectable("Product Z", "Shop Z")).toEqual(saved);
  });

  // cites: REQ-003/AC-011, R-003
  it("refuses a second product with the same name and shop and a different brand", async () => {
    await store.add(PRODUCT_A);
    await expect(store.add({ ...PRODUCT_A, brand: "Brand Y" })).rejects.toBeInstanceOf(DuplicateProductError);
  });

  // cites: REQ-003/AC-012, R-003
  it("refuses a duplicate when the shop differs only by case and spaces", async () => {
    await store.add({ ...PRODUCT_A, name: "Product B" });
    await expect(store.add({ ...PRODUCT_A, name: "Product B", shop: "  sHOP   a " })).rejects.toBeInstanceOf(
      DuplicateProductError,
    );
  });

  // cites: REQ-003/AC-013, R-003
  it("refuses a duplicate when the name differs only by case and spaces", async () => {
    await store.add({ ...PRODUCT_A, name: "Product C", shop: "Shop C" });
    await expect(store.add({ ...PRODUCT_A, name: " product   C  ", shop: "Shop C" })).rejects.toBeInstanceOf(
      DuplicateProductError,
    );
    expect(await store.findSelectable("PRODUCT  c", " shop c")).toBeDefined();
  });

  // cites: R-003
  it("allows the same name in another shop", async () => {
    await store.add({ ...PRODUCT_A, name: "Product D", shop: "Shop D" });
    const other = await store.add({ ...PRODUCT_A, name: "Product D", shop: "Shop E" });
    expect(other.shop).toBe("Shop E");
  });

  // cites: R-003
  it("lets exactly one of two concurrent identical adds succeed", async () => {
    const product = { ...PRODUCT_A, name: "Product R", shop: "Shop R" };
    const results = await Promise.allSettled([store.add(product), store.add({ ...product, name: "PRODUCT R" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBeInstanceOf(DuplicateProductError);
  });

  // cites: R-002
  it("refuses a row with a required value missing", async () => {
    await expect(
      pool.query(
        "INSERT INTO products (id, name, shop, calories, protein, fat, source) VALUES ('x1', 'P', 'S', NULL, 1, 1, 'manual')",
      ),
    ).rejects.toMatchObject({ code: "23502" });
  });
});
