// API tests for REQ-005: edit, soft-delete and restore products (S-QA-004). Each test creates its own data.
// Parts of REQ-005 that need day plans, the journal, dishes or the shopping plan are not covered here.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newProduct, startApi, type Api } from "./support/api.js";

let api: Api;

beforeAll(async () => {
  api = await startApi();
  await api.login();
});

afterAll(async () => {
  await api.close();
});

async function create(overrides: Record<string, unknown> = {}): Promise<any> {
  const res = await api.request("POST", "/products", newProduct(overrides));
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function listIds(state?: string): Promise<string[]> {
  const res = await api.request("GET", state ? `/products?state=${state}` : "/products");
  expect(res.statusCode).toBe(200);
  return (res.json() as Array<{ id: string }>).map((p) => p.id);
}

function unique(label: string): string {
  return `${label} ${randomUUID().slice(0, 8)}`;
}

describe("product lifecycle API", () => {
  // cites: REQ-005/AC-001, R-004, IF-001@1.3.0#editProduct
  it("records a new product on a calories edit, with versioned and replaced_id", async () => {
    const p = await create({ calories: 100 });
    const res = await api.request("PATCH", `/products/${p.id}`, { calories: 120 });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.versioned).toBe(true);
    expect(body.replaced_id).toBe(p.id);
    expect(body.product.calories).toBe(120);
    expect(body.product.id === p.id).toBe(false);
    expect(body.product.selectable).toBe(true);
  });

  // cites: REQ-005/AC-001, REQ-005/AC-010, R-004, IF-001@1.3.0#getProduct
  it("keeps the old product readable, unchanged, unselectable and pointing to the new one", async () => {
    const p = await create({ calories: 100 });
    const edited = (await api.request("PATCH", `/products/${p.id}`, { calories: 120 })).json();
    const res = await api.request("GET", `/products/${p.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: p.id,
      calories: 100,
      selectable: false,
      replaced_by: edited.product.id,
    });
  });

  // cites: REQ-005/AC-010, R-004, IF-001@1.3.0#listProducts
  it("lists the new version and not the replaced one as selectable", async () => {
    const p = await create({ calories: 100 });
    const edited = (await api.request("PATCH", `/products/${p.id}`, { calories: 120 })).json();
    const ids = await listIds();
    expect(ids).toContain(edited.product.id);
    expect(ids.includes(p.id)).toBe(false);
  });

  // cites: REQ-005/AC-001, R-004, IF-001@1.3.0#editProduct
  it("records a new product on a piece_weight edit", async () => {
    const p = await create({ piece_weight: 30 });
    const res = await api.request("PATCH", `/products/${p.id}`, { piece_weight: 40 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ versioned: true, replaced_id: p.id, product: { piece_weight: 40 } });
    const old = (await api.request("GET", `/products/${p.id}`)).json();
    expect(old).toMatchObject({ piece_weight: 30, selectable: false });
  });

  // cites: REQ-005/AC-010, R-004, IF-001@1.3.0#editProduct
  it("refuses to edit a replaced product with product.not_selectable", async () => {
    const p = await create({ calories: 100 });
    await api.request("PATCH", `/products/${p.id}`, { calories: 120 });
    const res = await api.request("PATCH", `/products/${p.id}`, { calories: 130 });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.not_selectable");
  });

  // cites: REQ-005/AC-010, R-004, IF-001@1.3.0#deleteProduct
  it("refuses to delete a replaced product with product.not_selectable", async () => {
    const p = await create({ calories: 100 });
    await api.request("PATCH", `/products/${p.id}`, { calories: 120 });
    const res = await api.request("DELETE", `/products/${p.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.not_selectable");
  });

  // cites: REQ-005/AC-010, R-004, IF-001@1.3.0#restoreProduct
  it("refuses to restore a replaced product with product.not_selectable", async () => {
    const p = await create({ calories: 100 });
    await api.request("PATCH", `/products/${p.id}`, { calories: 120 });
    const res = await api.request("POST", `/products/${p.id}/restore`);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.not_selectable");
  });

  // cites: REQ-005/AC-009, R-005, IF-001@1.3.0#editProduct
  it("changes a name in place with no new product", async () => {
    const p = await create();
    const newName = unique("Renamed");
    const res = await api.request("PATCH", `/products/${p.id}`, { name: newName });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.versioned).toBe(false);
    expect(body.replaced_id).toBe(null);
    expect(body.product.id).toBe(p.id);
    expect(body.product.name).toBe(newName);
    const read = (await api.request("GET", `/products/${p.id}`)).json();
    expect(read).toMatchObject({ name: newName, selectable: true, replaced_by: null });
  });

  // cites: REQ-005/AC-009, R-005, IF-001@1.3.0#editProduct
  it("changes brand, shop, portion_size and portion_calories in place", async () => {
    const p = await create();
    const res = await api.request("PATCH", `/products/${p.id}`, {
      brand: "Synthetic Brand",
      shop: "Shop B",
      portion_size: 30,
      portion_calories: 45,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.versioned).toBe(false);
    expect(body.replaced_id).toBe(null);
    expect(body.product).toMatchObject({
      id: p.id,
      brand: "Synthetic Brand",
      shop: "Shop B",
      portion_size: 30,
      portion_calories: 45,
    });
  });

  // cites: REQ-005/AC-013, R-003, R-004, IF-001@1.3.0#editProduct
  it("does not refuse a nutrient edit as a duplicate of the earlier version", async () => {
    const name = unique("Same name");
    const p = await create({ name, shop: "Shop A", calories: 100 });
    const res = await api.request("PATCH", `/products/${p.id}`, { calories: 120 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ versioned: true, product: { name, shop: "Shop A", calories: 120 } });
  });

  // cites: REQ-005/AC-014, R-003, IF-001@1.3.0#editProduct
  it("refuses renaming into a duplicate name and shop, ignoring letter case, and keeps the old name", async () => {
    const nameA = unique("Product A");
    const nameB = unique("Product B");
    await create({ name: nameA, shop: "Shop A" });
    const q = await create({ name: nameB, shop: "Shop A" });
    const res = await api.request("PATCH", `/products/${q.id}`, { name: nameA.toLowerCase() });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.duplicate_name_shop");
    const read = (await api.request("GET", `/products/${q.id}`)).json();
    expect(read.name).toBe(nameB);
  });

  // cites: REQ-005/AC-015, R-003, R-006, IF-001@1.3.0#restoreProduct
  it("refuses restoring into a duplicate and the product stays soft-deleted", async () => {
    const name = unique("Product A");
    const p = await create({ name, shop: "Shop A" });
    await api.request("DELETE", `/products/${p.id}`);
    await create({ name, shop: "Shop A" });
    const res = await api.request("POST", `/products/${p.id}/restore`);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.duplicate_name_shop");
    const read = (await api.request("GET", `/products/${p.id}`)).json();
    expect(read).toMatchObject({ deleted: true, selectable: false });
    expect(await listIds("deleted")).toContain(p.id);
  });

  // cites: REQ-005/AC-016, R-003, R-006, IF-001@1.3.0#createProduct
  it("lets a new product reuse the name and shop of a soft-deleted one", async () => {
    const name = unique("Product A");
    const p = await create({ name, shop: "Shop A" });
    await api.request("DELETE", `/products/${p.id}`);
    const res = await api.request("POST", "/products", newProduct({ name, shop: "Shop A" }));
    expect(res.statusCode).toBe(201);
    const read = (await api.request("GET", `/products/${p.id}`)).json();
    expect(read).toMatchObject({ deleted: true, selectable: false });
  });

  // cites: REQ-005/AC-004, REQ-005/AC-005, R-006, IF-001@1.3.0#deleteProduct, IF-001@1.3.0#listProducts
  it("soft-deletes a product: it leaves the list, shows as deleted, and stays readable by id", async () => {
    const p = await create();
    const res = await api.request("DELETE", `/products/${p.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: p.id, deleted: true, selectable: false });
    expect((await listIds()).includes(p.id)).toBe(false);
    expect(await listIds("deleted")).toContain(p.id);
    const read = await api.request("GET", `/products/${p.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ id: p.id, deleted: true, selectable: false });
  });

  // cites: REQ-005/AC-005, R-006, IF-001@1.3.0#editProduct
  it("refuses to edit a soft-deleted product with product.not_selectable", async () => {
    const p = await create();
    await api.request("DELETE", `/products/${p.id}`);
    const res = await api.request("PATCH", `/products/${p.id}`, { name: unique("Other") });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.not_selectable");
  });

  // cites: REQ-005/AC-011, R-006, IF-001@1.3.0#restoreProduct, IF-001@1.3.0#listProducts
  it("restores a soft-deleted product, selectable again with the same values", async () => {
    const p = await create({ calories: 150 });
    await api.request("DELETE", `/products/${p.id}`);
    const res = await api.request("POST", `/products/${p.id}/restore`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: p.id, deleted: false, selectable: true, calories: 150, name: p.name });
    expect(await listIds()).toContain(p.id);
    expect((await listIds("deleted")).includes(p.id)).toBe(false);
  });

  // cites: IF-001@1.3.0#deleteProduct, IF-001@1.3.0#restoreProduct
  it("returns an already soft-deleted product unchanged on delete, and a selectable one unchanged on restore", async () => {
    const p = await create();
    await api.request("DELETE", `/products/${p.id}`);
    const again = await api.request("DELETE", `/products/${p.id}`);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id: p.id, deleted: true });
    await api.request("POST", `/products/${p.id}/restore`);
    const restoredAgain = await api.request("POST", `/products/${p.id}/restore`);
    expect(restoredAgain.statusCode).toBe(200);
    expect(restoredAgain.json()).toMatchObject({ id: p.id, deleted: false, selectable: true });
  });

  // cites: IF-001@1.3.0#editProduct
  it("returns 200 with versioned false and records nothing when an edit changes no value", async () => {
    const p = await create({ calories: 100 });
    const res = await api.request("PATCH", `/products/${p.id}`, { calories: 100 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ versioned: false, replaced_id: null, product: { id: p.id } });
  });

  // cites: IF-001@1.3.0#getProduct, IF-001@1.3.0#editProduct, IF-001@1.3.0#deleteProduct, IF-001@1.3.0#restoreProduct
  it("answers product.not_found for an unknown id on read, edit, delete and restore", async () => {
    const id = `missing-${randomUUID()}`;
    const results = await Promise.all([
      api.request("GET", `/products/${id}`),
      api.request("PATCH", `/products/${id}`, { name: unique("X") }),
      api.request("DELETE", `/products/${id}`),
      api.request("POST", `/products/${id}/restore`),
    ]);
    for (const res of results) {
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("product.not_found");
    }
  });
});
