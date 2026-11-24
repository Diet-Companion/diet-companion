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

function item(name: string, shop = "Shop A"): NewProduct {
  return { name, shop, calories: 100, protein: 1, fat: 1, source: "manual" };
}

type StateRow = { id: string; calories: number; name: string; replaced_by: string | null; deleted_at: Date | null };
const rowsFor = async (name: string, shop = "Shop A"): Promise<StateRow[]> =>
  (
    await pool.query<StateRow>(
      "SELECT id, calories, name, replaced_by, deleted_at FROM products WHERE name = $1 AND shop = $2 ORDER BY id",
      [name, shop],
    )
  ).rows;

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
  store = new PostgresProductStore(pool, () => `edit-${++n}`);
});

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

describe("PostgresProductStore.edit", () => {
  // cites: REQ-005/AC-001, REQ-005/AC-013, REQ-005/AC-010, ADR-010/C-004
  it("records the new row and sets replaced_by on the old row, and the partial unique index allows the pair", async () => {
    const p = await store.add(item("Edit A"));
    const outcome = await store.edit(p.id, { calories: 120 });
    expect(outcome?.versioned).toBe(true);
    expect(outcome?.replaced_id).toBe(p.id);
    const rows = await rowsFor("Edit A");
    expect(rows).toHaveLength(2);
    const old = rows.find((r) => r.id === p.id);
    const fresh = rows.find((r) => r.id !== p.id);
    expect(old).toMatchObject({ calories: 100, replaced_by: fresh?.id, deleted_at: null });
    expect(fresh).toMatchObject({ id: outcome?.product.id, calories: 120, replaced_by: null, deleted_at: null });
    expect(await store.findSelectable("Edit A", "Shop A")).toEqual(outcome?.product);
    const selectable = (await store.listByState("selectable")).map((r) => r.product.id);
    expect(selectable).toContain(fresh?.id);
    expect(selectable).not.toContain(p.id);
  });

  // cites: REQ-005/AC-009, R-005
  it("edits the name in place with the same id and no new row", async () => {
    const p = await store.add(item("Edit B"));
    const outcome = await store.edit(p.id, { name: "Edit B renamed" });
    expect(outcome).toMatchObject({ versioned: false, replaced_id: null });
    expect(outcome?.product).toEqual({ ...p, name: "Edit B renamed" });
    expect(await rowsFor("Edit B")).toHaveLength(0);
    expect(await rowsFor("Edit B renamed")).toHaveLength(1);
  });

  // cites: REQ-005/AC-014, R-003, ADR-010/C-004
  it("rolls the whole versioned edit back when the new row would duplicate a selectable product", async () => {
    await store.add(item("Edit C"));
    const q = await store.add(item("Edit D"));
    await expect(store.edit(q.id, { name: "edit  c", calories: 130 })).rejects.toBeInstanceOf(DuplicateProductError);
    expect(await rowsFor("Edit D")).toEqual([expect.objectContaining({ id: q.id, replaced_by: null, calories: 100 })]);
    expect(await rowsFor("edit  c")).toHaveLength(0);
  });

  // cites: REQ-005/AC-014, R-003
  it("refuses an in-place rename into another selectable product and keeps the name", async () => {
    await store.add(item("Edit E"));
    const q = await store.add(item("Edit F"));
    await expect(store.edit(q.id, { name: "EDIT E" })).rejects.toBeInstanceOf(DuplicateProductError);
    expect((await store.get(q.id))?.product.name).toBe("Edit F");
  });

  // cites: ADR-010/C-004, IF-001@1.2.0#editProduct
  it("lets one of two concurrent versioned edits win and refuses the other as not selectable", async () => {
    const p = await store.add(item("Edit G"));
    const results = await Promise.allSettled([store.edit(p.id, { calories: 150 }), store.edit(p.id, { calories: 160 })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed && failed.status === "rejected" && failed.reason).toBeInstanceOf(NotSelectableError);
    expect(await rowsFor("Edit G")).toHaveLength(2);
  });

  // cites: IF-001@1.2.0#editProduct
  it("refuses a soft-deleted product, returns undefined for an unknown id and records nothing for no change", async () => {
    const p = await store.add(item("Edit H"));
    expect(await store.edit(p.id, { name: "Edit H" })).toEqual({ product: p, versioned: false, replaced_id: null });
    await store.softDelete(p.id, new Date("2026-01-02T03:04:05.000Z"));
    await expect(store.edit(p.id, { name: "Edit H2" })).rejects.toBeInstanceOf(NotSelectableError);
    expect(await store.edit("no-such-id", { name: "x" })).toBeUndefined();
    expect(await rowsFor("Edit H")).toHaveLength(1);
  });
});
