import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryProductStore, type NewProduct } from "./products.js";

const NOW = new Date("2026-01-02T03:04:05.000Z");

function setup(owner = true) {
  let n = 0;
  const store = new InMemoryProductStore(() => `id-${++n}`);
  const app = buildApp({ store, isOwner: owner ? () => true : undefined, clock: () => NOW });
  return { app, store };
}

function item(name: string, shop = "Shop A"): NewProduct {
  return { name, shop, calories: 100, protein: 1, fat: 1, source: "manual" };
}

type App = ReturnType<typeof setup>["app"];
const remove = (app: App, id: string) => app.inject({ method: "DELETE", url: `/products/${id}` });
const restore = (app: App, id: string) => app.inject({ method: "POST", url: `/products/${id}/restore` });
const read = (app: App, id: string) => app.inject({ method: "GET", url: `/products/${id}` });
const names = async (app: App, query = "") =>
  ((await app.inject({ method: "GET", url: `/products${query}` })).json() as { name: string }[]).map((p) => p.name);

describe("deleteProduct", () => {
  // cites: REQ-005/AC-004, R-006
  it("soft-deletes with deleted_at from the clock and drops the product from the selectable list", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const res = await remove(app, p.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: p.id, deleted: true, selectable: false, replaced_by: null });
    expect((await store.get(p.id))?.state.deleted_at).toEqual(NOW);
    expect(await names(app)).toEqual([]);
  });

  // cites: REQ-005/AC-004, R-006
  it("keeps a deleted product readable by id with its values", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    await remove(app, p.id);
    const res = await read(app, p.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: p.id, name: "Product A", calories: 100, deleted: true, selectable: false });
  });

  // cites: REQ-005/AC-005, R-006
  it("does not list a soft-deleted product among the selectable ones", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    await store.add(item("Product B"));
    await remove(app, p.id);
    expect(await names(app)).toEqual(["Product B"]);
    expect(await names(app, "?state=selectable")).toEqual(["Product B"]);
  });

  // cites: R-006
  it("returns an already deleted product unchanged", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    await store.softDelete(p.id, new Date("2025-05-05T00:00:00.000Z"));
    const res = await remove(app, p.id);
    expect(res.statusCode).toBe(200);
    expect((await store.get(p.id))?.state.deleted_at).toEqual(new Date("2025-05-05T00:00:00.000Z"));
  });

  // cites: IF-001@1.2.0#deleteProduct
  it("answers 409 product.not_selectable for a replaced product and changes nothing", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const next = await store.add(item("Product A2"));
    store.seedState(p.id, { replaced_by: next.id, deleted_at: null });
    const res = await remove(app, p.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.not_selectable");
    expect((await store.get(p.id))?.state.deleted_at).toBeNull();
  });

  // cites: IF-001@1.2.0#deleteProduct
  it("answers 404 product.not_found for an unknown id", async () => {
    const { app } = setup();
    const res = await remove(app, "missing");
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("product.not_found");
  });
});

describe("restoreProduct", () => {
  // cites: REQ-005/AC-011, R-006
  it("makes a soft-deleted product selectable again with its values unchanged", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    await remove(app, p.id);
    const res = await restore(app, p.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: p.id, name: "Product A", calories: 100, deleted: false, selectable: true });
    expect(await names(app)).toEqual(["Product A"]);
    expect(await names(app, "?state=deleted")).toEqual([]);
  });

  // cites: REQ-005/AC-015, R-003, R-006
  it("refuses a restore that would give two selectable products the same name and shop", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    await remove(app, p.id);
    await store.add(item("product  a"));
    const res = await restore(app, p.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.duplicate_name_shop");
    expect((await store.get(p.id))?.state.deleted_at).toEqual(NOW);
    expect(await names(app, "?state=deleted")).toEqual(["Product A"]);
  });

  // cites: IF-001@1.2.0#restoreProduct
  it("returns a product that is already selectable unchanged", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const res = await restore(app, p.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: p.id, deleted: false, selectable: true });
  });

  // cites: IF-001@1.2.0#restoreProduct
  it("answers 409 product.not_selectable for a replaced product", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const next = await store.add(item("Product A2"));
    store.seedState(p.id, { replaced_by: next.id, deleted_at: null });
    const res = await restore(app, p.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.not_selectable");
  });

  // cites: IF-001@1.2.0#restoreProduct
  it("answers 404 product.not_found for an unknown id", async () => {
    const { app } = setup();
    expect((await restore(app, "missing")).statusCode).toBe(404);
  });
});

describe("products in other states", () => {
  // cites: REQ-005/AC-016, R-003, R-006
  it("saves a new product with the name and shop of a soft-deleted one and leaves that one deleted", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    await remove(app, p.id);
    const res = await app.inject({ method: "POST", url: "/products", payload: item("Product A") });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).not.toBe(p.id);
    expect((await store.get(p.id))?.state.deleted_at).toEqual(NOW);
  });

  // cites: R-003
  it("still refuses a new product that duplicates a selectable one", async () => {
    const { app, store } = setup();
    await store.add(item("Product A"));
    const res = await app.inject({ method: "POST", url: "/products", payload: item("PRODUCT A") });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.duplicate_name_shop");
  });

  // cites: IF-001@1.2.0#listProducts
  it("never lists a replaced version, and reads it by id with replaced_by set", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const next = await store.add(item("Product A2"));
    store.seedState(p.id, { replaced_by: next.id, deleted_at: null });
    expect(await names(app)).toEqual(["Product A2"]);
    expect(await names(app, "?state=deleted")).toEqual([]);
    expect((await read(app, p.id)).json()).toMatchObject({ id: p.id, replaced_by: next.id, deleted: false, selectable: false });
  });

  // cites: IF-001@1.2.0#listProducts
  it("orders the list by name then shop ignoring letter case", async () => {
    const { app, store } = setup();
    await store.add(item("bravo", "Shop B"));
    await store.add(item("Alpha", "Shop B"));
    await store.add(item("BRAVO", "Shop A"));
    const res = await app.inject({ method: "GET", url: "/products" });
    expect((res.json() as { name: string; shop: string }[]).map((p) => `${p.name}/${p.shop}`)).toEqual([
      "Alpha/Shop B",
      "BRAVO/Shop A",
      "bravo/Shop B",
    ]);
  });

  // cites: IF-001@1.2.0#listProducts
  it("refuses an unknown state value", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/products?state=all" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("request.invalid");
  });

  // cites: IF-001@1.2.0#createProduct
  it("returns replaced_by, deleted and selectable on a created product", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "POST", url: "/products", payload: item("Product A") });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ replaced_by: null, deleted: false, selectable: true, sodium: 0, counted_by_piece: false });
  });

  // cites: IF-001@1.2.0#getProduct
  it("answers 404 product.not_found when reading an unknown id", async () => {
    const { app } = setup();
    const res = await read(app, "missing");
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("product.not_found");
  });

  // cites: IF-001@1.2.0#listProducts, IF-001@1.2.0#getProduct, IF-001@1.2.0#deleteProduct, IF-001@1.2.0#restoreProduct
  it("requires the Owner session on every new route", async () => {
    const { app } = setup(false);
    const calls = [
      { method: "GET" as const, url: "/products" },
      { method: "GET" as const, url: "/products/x" },
      { method: "DELETE" as const, url: "/products/x" },
      { method: "POST" as const, url: "/products/x/restore" },
    ];
    for (const call of calls) {
      const res = await app.inject(call);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("auth.required");
    }
  });
});
