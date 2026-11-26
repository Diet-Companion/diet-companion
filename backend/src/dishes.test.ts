import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryDishStore } from "./in-memory-dish-store.js";
import { InMemoryProductStore, type NewProduct } from "./products.js";

const NOW = new Date("2026-01-02T03:04:05.000Z");

function setup(owner = true) {
  let p = 0;
  let d = 0;
  const products = new InMemoryProductStore(() => `p-${++p}`);
  const dishes = new InMemoryDishStore(() => `d-${++d}`);
  const app = buildApp({
    store: products,
    dishStore: dishes,
    isOwner: owner ? () => true : undefined,
    clock: () => NOW,
  });
  return { app, products, dishes };
}

function item(name: string, extra: Partial<NewProduct> = {}): NewProduct {
  return { name, shop: "Shop A", calories: 100, protein: 1, fat: 1, source: "manual", ...extra };
}

type App = ReturnType<typeof setup>["app"];
type Line = { product_id: string; grams?: number; pieces?: number };
const create = (app: App, name: string, lines: Line[]) =>
  app.inject({ method: "POST", url: "/dishes", payload: { name, lines } });
const read = (app: App, id: string) => app.inject({ method: "GET", url: `/dishes/${id}` });
const names = async (app: App, query = "") =>
  ((await app.inject({ method: "GET", url: `/dishes${query}` })).json() as { name: string }[]).map((x) => x.name);

async function omelette() {
  const ctx = setup();
  const white = await ctx.products.add(item("Egg white"));
  const egg = await ctx.products.add(item("Egg", { piece_weight: 50 }));
  return { ...ctx, white, egg };
}

describe("createDish", () => {
  // cites: REQ-006/AC-001, R-007
  it("saves a dish with both products and their amounts", async () => {
    const { app, white, egg } = await omelette();
    const res = await create(app, "omelette", [
      { product_id: white.id, grams: 100 },
      { product_id: egg.id, pieces: 2 },
    ]);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("omelette");
    expect(body.lines.map((l: { product: { id: string } }) => l.product.id)).toEqual([white.id, egg.id]);
    expect(body.lines[0]).toMatchObject({ position: 0, grams: 100, pieces: null });
    expect(body.lines[1]).toMatchObject({ position: 1, grams: null, pieces: 2 });
    expect((await read(app, body.id)).statusCode).toBe(200);
  });

  // cites: REQ-006/AC-002, R-007
  it("weighs a piece line as pieces times the piece weight", async () => {
    const { app, white, egg } = await omelette();
    const res = await create(app, "omelette", [
      { product_id: white.id, grams: 100 },
      { product_id: egg.id, pieces: 2 },
    ]);
    const body = res.json();
    expect(body.lines[1].weight_grams).toBe(100);
    expect(body.lines[0].weight_grams).toBe(100);
    expect(body.total_weight_grams).toBe(200);
  });

  // cites: REQ-006/AC-003, R-007
  it("refuses pieces for a product without a piece weight and saves nothing", async () => {
    const { app, white } = await omelette();
    const res = await create(app, "omelette", [{ product_id: white.id, pieces: 2 }]);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "dish.line_invalid",
      lines: [{ index: 0, reason: "piece_without_weight" }],
    });
    expect(await names(app)).toEqual([]);
  });

  // cites: REQ-006/AC-013, R-007
  it("reports the missing lines when a dish has a name and no line", async () => {
    const { app } = await omelette();
    for (const lines of [[], undefined]) {
      const res = await app.inject({ method: "POST", url: "/dishes", payload: { name: "omelette", lines } });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ code: "dish.values_missing", missing: ["lines"] });
    }
    expect(await names(app)).toEqual([]);
  });

  // cites: REQ-006/AC-014, R-007
  it("reports the missing name when a dish has a line and a blank name", async () => {
    const { app, white } = await omelette();
    const res = await create(app, "   ", [{ product_id: white.id, grams: 100 }]);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "dish.values_missing", missing: ["name"] });
    expect(await names(app)).toEqual([]);
  });

  // cites: REQ-006/AC-017, R-010
  it("saves a second dish with the same name without a warning", async () => {
    const { app, white } = await omelette();
    const first = await create(app, "omelette", [{ product_id: white.id, grams: 100 }]);
    const second = await create(app, "omelette", [{ product_id: white.id, grams: 100 }]);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().id).not.toBe(first.json().id);
    expect(await names(app)).toEqual(["omelette", "omelette"]);
  });

  // cites: REQ-006/AC-003, REQ-006/AC-013, R-007
  it("names every refused line by its index, with a reason", async () => {
    const { app, white, products } = await omelette();
    const gone = await products.add(item("Old"));
    await products.softDelete(gone.id, NOW);
    const res = await create(app, "mix", [
      { product_id: white.id, grams: 100 },
      { product_id: "missing", grams: 5 },
      { product_id: gone.id, grams: 5 },
      { product_id: white.id, grams: 0 },
      { product_id: white.id, grams: 1, pieces: 1 },
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().lines).toEqual([
      { index: 1, reason: "product_not_found" },
      { index: 2, reason: "product_not_selectable" },
      { index: 3, reason: "amount_invalid" },
      { index: 4, reason: "amount_invalid" },
    ]);
    expect(await names(app)).toEqual([]);
  });
});

describe("product state on a dish line", () => {
  // cites: REQ-006/AC-015, R-009
  it("keeps the old product on the line after a nutrient edit and flags the dish", async () => {
    const { app, white, products } = await omelette();
    const saved = await create(app, "omelette", [{ product_id: white.id, grams: 100 }]);
    const edited = await products.edit(white.id, { calories: 200 });
    expect(edited?.versioned).toBe(true);
    const body = (await read(app, saved.json().id)).json();
    expect(body.lines[0].product).toMatchObject({
      id: white.id,
      calories: 100,
      replaced_by: edited?.product.id,
      selectable: false,
    });
    expect(body.has_unselectable_product).toBe(true);
  });

  // cites: REQ-006/AC-018, R-009, R-005
  it("shows the new name of a product edited in place and creates no new dish", async () => {
    const { app, white, products } = await omelette();
    const saved = await create(app, "omelette", [{ product_id: white.id, grams: 100 }]);
    await products.edit(white.id, { name: "Egg white B" });
    const body = (await read(app, saved.json().id)).json();
    expect(body.lines[0]).toMatchObject({ grams: 100, product: { id: white.id, name: "Egg white B", calories: 100 } });
    expect(body.has_unselectable_product).toBe(false);
    expect(await names(app)).toEqual(["omelette"]);
  });
});

describe("deleteDish and restoreDish", () => {
  // cites: REQ-006/AC-011, R-010
  it("soft-deletes, hides the dish from the selectable list and keeps it readable", async () => {
    const { app, white, dishes } = await omelette();
    const saved = (await create(app, "omelette", [{ product_id: white.id, grams: 100 }])).json();
    const res = await app.inject({ method: "DELETE", url: `/dishes/${saved.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: saved.id, deleted: true, selectable: false });
    expect((await dishes.get(saved.id))?.state.deleted_at).toEqual(NOW);
    expect(await names(app)).toEqual([]);
    expect(await names(app, "?state=deleted")).toEqual(["omelette"]);
    expect((await read(app, saved.id)).json()).toMatchObject({ name: "omelette", deleted: true });
  });

  // cites: REQ-006/AC-012, R-010
  it("marks a soft-deleted dish as not selectable and refuses to change a replaced one", async () => {
    const { app, white, dishes } = await omelette();
    const saved = (await create(app, "omelette", [{ product_id: white.id, grams: 100 }])).json();
    await app.inject({ method: "DELETE", url: `/dishes/${saved.id}` });
    expect((await read(app, saved.id)).json().selectable).toBe(false);
    dishes.seedState(saved.id, { replaced_by: "d-new", deleted_at: null });
    const del = await app.inject({ method: "DELETE", url: `/dishes/${saved.id}` });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe("dish.not_selectable");
    const back = await app.inject({ method: "POST", url: `/dishes/${saved.id}/restore` });
    expect(back.statusCode).toBe(409);
    expect(back.json().code).toBe("dish.not_selectable");
  });

  // cites: REQ-006/AC-016, A-010, R-010
  it("restores a soft-deleted dish with its lines unchanged", async () => {
    const { app, white } = await omelette();
    const saved = (await create(app, "omelette", [{ product_id: white.id, grams: 100 }])).json();
    await app.inject({ method: "DELETE", url: `/dishes/${saved.id}` });
    const res = await app.inject({ method: "POST", url: `/dishes/${saved.id}/restore` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: saved.id, deleted: false, selectable: true, lines: saved.lines });
    expect(await names(app)).toEqual(["omelette"]);
  });

  // cites: R-010
  it("answers dish.not_found for an unknown id", async () => {
    const { app } = await omelette();
    const calls = [
      app.inject({ method: "GET", url: "/dishes/nope" }),
      app.inject({ method: "DELETE", url: "/dishes/nope" }),
      app.inject({ method: "POST", url: "/dishes/nope/restore" }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("dish.not_found");
    }
  });
});

describe("listDishes", () => {
  // cites: R-010
  it("orders by name ignoring letter case, then by id", async () => {
    const { app, white } = await omelette();
    const line = [{ product_id: white.id, grams: 1 }];
    await create(app, "banana bread", line);
    await create(app, "Apple pie", line);
    await create(app, "cake", line);
    expect(await names(app)).toEqual(["Apple pie", "banana bread", "cake"]);
  });

  // cites: R-010
  it("refuses an unknown state filter", async () => {
    const { app } = await omelette();
    const res = await app.inject({ method: "GET", url: "/dishes?state=all" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("request.invalid");
  });
});

describe("the Owner session", () => {
  // cites: IF-001@1.3.0#listDishes, IF-001@1.3.0#createDish, IF-001@1.3.0#getDish, IF-001@1.3.0#deleteDish, IF-001@1.3.0#restoreDish
  it("is required on every dish route", async () => {
    const { app } = setup(false);
    const calls = [
      app.inject({ method: "GET", url: "/dishes" }),
      app.inject({ method: "POST", url: "/dishes", payload: { name: "x", lines: [] } }),
      app.inject({ method: "GET", url: "/dishes/d-1" }),
      app.inject({ method: "DELETE", url: "/dishes/d-1" }),
      app.inject({ method: "POST", url: "/dishes/d-1/restore" }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("auth.required");
    }
  });
});
