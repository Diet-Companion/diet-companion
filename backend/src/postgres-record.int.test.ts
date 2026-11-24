import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import { PostgresProductStore } from "./postgres-store.js";
import type { NewProduct } from "./products.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point at a test database");

const schema = `t_${randomUUID().replace(/-/g, "")}`;
const options = `-c search_path=${schema}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
let pool: pg.Pool;
let store: PostgresProductStore;
let n = 0;

const FULL: NewProduct = {
  name: "Product F",
  shop: "Shop F",
  calories: 120,
  protein: 3,
  fat: 2,
  brand: "Brand F",
  source: "manual",
  carbohydrate: 20,
  sugars: 4,
  fibre: 1.5,
  salt: 1.5,
  portion_size: 10,
  portion_calories: 37.7,
  piece_weight: 50,
};

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  const client = new pg.Client({ connectionString: url, options });
  await client.connect();
  try {
    const dir = join(import.meta.dirname, "..", "migrations");
    await runMigrations(client, dir);
  } finally {
    await client.end();
  }
  pool = new pg.Pool({ connectionString: url, options, max: 2 });
  store = new PostgresProductStore(pool, () => `rec-${++n}`);
});

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

describe("migration 003 on PostgreSQL", () => {
  // cites: REQ-002/AC-008, REQ-002/AC-009, IF-001@1.1.0#createProduct
  it("round-trips a product with every field", async () => {
    const saved = await store.add(FULL);
    expect(saved).toEqual({ ...FULL, id: saved.id });
    expect(await store.findSelectable("product f", "SHOP F")).toEqual(saved);
  });

  // cites: REQ-002/AC-004, REQ-002/AC-012
  it("keeps the optional fields empty when none is given", async () => {
    const base: NewProduct = { name: "Product G", shop: "Shop G", calories: 1, protein: 1, fat: 1, source: "manual" };
    const saved = await store.add(base);
    expect(saved).toEqual({ ...base, id: saved.id });
  });

  // cites: REQ-002/AC-006
  it("stores a real 0 for a nutrient", async () => {
    const saved = await store.add({ name: "Product H", shop: "Shop H", calories: 1, protein: 1, fat: 1, source: "manual", salt: 0 });
    expect(saved.salt).toBe(0);
  });

  // cites: IF-001@1.1.0#createProduct
  it("refuses a negative value in each new column", async () => {
    const columns = ["carbohydrate", "sugars", "fibre", "salt", "portion_size_g", "portion_calories", "piece_weight_g"];
    for (const column of columns) {
      await expect(
        pool.query(
          `INSERT INTO products (id, name, shop, calories, protein, fat, source, ${column}) VALUES ($1, $2, 'S', 1, 1, 1, 'manual', -1)`,
          [`neg-${column}`, `Neg ${column}`],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  // cites: IF-001@1.1.0#createProduct
  it("reads a row written with only the earlier columns with the new fields empty", async () => {
    await pool.query(
      "INSERT INTO products (id, name, shop, calories, protein, fat, source) VALUES ('old-1', 'Old', 'S', 1, 1, 1, 'label')",
    );
    const row = await store.findSelectable("Old", "S");
    expect(row).toEqual({ id: "old-1", name: "Old", shop: "S", calories: 1, protein: 1, fat: 1, source: "label" });
  });
});
