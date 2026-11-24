import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryProductStore, type NewProduct } from "./products.js";

function setup(owner = true) {
  let n = 0;
  const store = new InMemoryProductStore(() => `id-${++n}`);
  const app = buildApp({ store, isOwner: owner ? () => true : undefined });
  return { app, store };
}

function item(name: string, shop = "Shop A", extra: Partial<NewProduct> = {}): NewProduct {
  return { name, shop, calories: 100, protein: 1, fat: 1, source: "manual", ...extra };
}

type App = ReturnType<typeof setup>["app"];
const edit = (app: App, id: string, body: unknown) =>
  app.inject({ method: "PATCH", url: `/products/${id}`, payload: body as object });
const names = async (app: App) =>
  ((await app.inject({ method: "GET", url: "/products" })).json() as { name: string; calories: number }[]).map(
    (p) => `${p.name}:${p.calories}`,
  );

describe("editProduct, a nutrient change", () => {
  // cites: REQ-005/AC-001, R-004
  it("records a new product with the new calories and leaves the old one unchanged", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const res = await edit(app, p.id, { calories: 120 });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.versioned).toBe(true);
    expect(body.replaced_id).toBe(p.id);
    expect(body.product).toMatchObject({ name: "Product A", shop: "Shop A", calories: 120, selectable: true });
    expect(body.product.id).not.toBe(p.id);
    const old = await store.get(p.id);
    expect(old?.product.calories).toBe(100);
    expect(old?.state.replaced_by).toBe(body.product.id);
  });

  // cites: REQ-005/AC-013, R-003, R-004
  it("does not refuse a nutrient edit as a duplicate of the old version", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const res = await edit(app, p.id, { calories: 120 });
    expect(res.statusCode).toBe(201);
    expect(res.json().code).toBeUndefined();
  });

  // cites: REQ-005/AC-003, R-004
  it("lists the new product and not the old one, so planning uses the new one", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    await edit(app, p.id, { calories: 120 });
    expect(await names(app)).toEqual(["Product A:120"]);
  });

  // cites: REQ-005/AC-010, R-004
  it("makes the old product not selectable, keeps it readable and refuses to edit it again", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const first = await edit(app, p.id, { calories: 120 });
    const read = await app.inject({ method: "GET", url: `/products/${p.id}` });
    expect(read.json()).toMatchObject({ id: p.id, calories: 100, selectable: false, replaced_by: first.json().product.id });
    const again = await edit(app, p.id, { calories: 130 });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("product.not_selectable");
    expect(store.list()).toHaveLength(2);
  });

  // cites: IF-001@1.2.0#editProduct, ADR-011/C-002
  it("treats a piece weight change as a nutrient change", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A", "Shop A", { piece_weight: 30 }));
    const res = await edit(app, p.id, { piece_weight: 40 });
    expect(res.statusCode).toBe(201);
    expect(res.json().product.piece_weight).toBe(40);
  });

  // cites: IF-001@1.2.0#editProduct
  it("records a new product with all merged values for a mixed change", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const res = await edit(app, p.id, { name: "Product B", calories: 120 });
    expect(res.statusCode).toBe(201);
    expect(res.json().product).toMatchObject({ name: "Product B", calories: 120 });
    expect((await store.get(p.id))?.product.name).toBe("Product A");
  });

  // cites: REQ-005/AC-014, R-003
  it("refuses a versioned edit that renames into another selectable product and saves nothing", async () => {
    const { app, store } = setup();
    await store.add(item("Product A"));
    const q = await store.add(item("Product B"));
    const res = await edit(app, q.id, { name: "product a", calories: 120 });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.duplicate_name_shop");
    expect(store.list()).toHaveLength(2);
    expect((await store.get(q.id))?.state.replaced_by).toBeNull();
  });
});

describe("editProduct, an in-place change", () => {
  // cites: REQ-005/AC-009, R-005
  it("changes only the name in place and records no new product", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const res = await edit(app, p.id, { name: "Product B" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ versioned: false, replaced_id: null });
    expect(body.product).toMatchObject({ id: p.id, name: "Product B", calories: 100 });
    expect(store.list()).toHaveLength(1);
  });

  // cites: REQ-005/AC-014, R-003
  it("refuses a rename into the name and shop of another selectable product and keeps the old name", async () => {
    const { app, store } = setup();
    await store.add(item("Product A"));
    const q = await store.add(item("Product B"));
    const res = await edit(app, q.id, { name: "product a" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.duplicate_name_shop");
    expect((await store.get(q.id))?.product.name).toBe("Product B");
  });

  // cites: REQ-005/AC-014, R-003
  it("ignores letter case and extra spaces when it looks for a duplicate", async () => {
    const { app, store } = setup();
    await store.add(item("Product A"));
    const q = await store.add(item("Product B"));
    const res = await edit(app, q.id, { name: "  PRODUCT   a " });
    expect(res.statusCode).toBe(409);
  });

  // cites: R-003, R-005
  it("does not count the product against itself when only the letter case changes", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const res = await edit(app, p.id, { name: "product a" });
    expect(res.statusCode).toBe(200);
    expect(res.json().product.name).toBe("product a");
  });

  // cites: IF-001@1.2.0#editProduct
  it("answers 200 and records nothing when no value changes", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const res = await edit(app, p.id, { name: "Product A", calories: 100 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ versioned: false, replaced_id: null });
    expect(store.list()).toHaveLength(1);
  });

  // cites: IF-001@1.2.0#editProduct
  it("clears an optional value with null", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A", "Shop A", { brand: "Brand X" }));
    const res = await edit(app, p.id, { brand: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().product.brand).toBeUndefined();
  });

  // cites: IF-001@1.2.0#editProduct
  it("stores a 0 portion size as empty", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A", "Shop A", { portion_size: 50, portion_calories: 60 }));
    const res = await edit(app, p.id, { portion_size: 0 });
    expect(res.statusCode).toBe(200);
    expect(res.json().product.portion_size).toBeUndefined();
    expect(res.json().product.portion_calories).toBe(60);
  });

  // cites: IF-001@1.2.0#editProduct
  it("ignores the read-only values a client sends", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const res = await edit(app, p.id, {
      name: "Product B",
      sodium: 999,
      counted_by_piece: true,
      replaced_by: "other",
      deleted: true,
      selectable: false,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().product).toMatchObject({ name: "Product B", sodium: 0, counted_by_piece: false, replaced_by: null, deleted: false, selectable: true });
  });
});

describe("editProduct, refusals", () => {
  // cites: IF-001@1.2.0#editProduct
  it("answers 400 request.invalid for an empty body, only ignored values, or a field that cannot be edited", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    for (const body of [{}, { sodium: 5 }, { source: "label" }, { id: "x" }]) {
      const res = await edit(app, p.id, body);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("request.invalid");
    }
  });

  // cites: IF-001@1.2.0#editProduct
  it("answers 400 product.value_invalid for a negative value and saves nothing", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const res = await edit(app, p.id, { calories: -1, name: "Product B" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "product.value_invalid", invalid: ["calories"] });
    expect((await store.get(p.id))?.product).toEqual(p);
  });

  // cites: IF-001@1.2.0#editProduct, R-002
  it("answers 422 product.values_missing for a required value set to null or blank", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    const nulled = await edit(app, p.id, { calories: null });
    expect(nulled.statusCode).toBe(422);
    expect(nulled.json()).toMatchObject({ code: "product.values_missing", missing: ["calories"] });
    const blank = await edit(app, p.id, { name: "   " });
    expect(blank.statusCode).toBe(422);
    expect(blank.json().missing).toEqual(["name"]);
    expect((await store.get(p.id))?.product).toEqual(p);
  });

  // cites: IF-001@1.2.0#editProduct
  it("answers 409 product.not_selectable for a soft-deleted product", async () => {
    const { app, store } = setup();
    const p = await store.add(item("Product A"));
    await store.softDelete(p.id, new Date("2026-01-02T03:04:05.000Z"));
    const res = await edit(app, p.id, { name: "Product B" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.not_selectable");
  });

  // cites: IF-001@1.2.0#editProduct
  it("answers 404 product.not_found for an unknown id", async () => {
    const { app } = setup();
    const res = await edit(app, "no-such-id", { name: "Product B" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("product.not_found");
  });

  // cites: IF-001@1.2.0#editProduct
  it("refuses a request without an Owner session and saves nothing", async () => {
    const { app, store } = setup(false);
    const p = await store.add(item("Product A"));
    const res = await edit(app, p.id, { name: "Product B" });
    expect(res.statusCode).toBe(401);
    expect((await store.get(p.id))?.product.name).toBe("Product A");
  });
});
