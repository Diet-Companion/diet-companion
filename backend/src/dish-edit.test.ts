import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryDishStore } from "./in-memory-dish-store.js";
import { InMemoryProductStore, type NewProduct } from "./products.js";

const NOW = new Date("2026-01-02T03:04:05.000Z");

function setup() {
  let p = 0;
  let d = 0;
  const products = new InMemoryProductStore(() => `p-${++p}`);
  const dishes = new InMemoryDishStore(() => `d-${++d}`);
  const app = buildApp({ store: products, dishStore: dishes, isOwner: () => true, clock: () => NOW });
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
const patch = (app: App, id: string, payload: unknown) =>
  app.inject({ method: "PATCH", url: `/dishes/${id}`, payload: payload as Record<string, unknown> });
const listed = async (app: App) =>
  ((await app.inject({ method: "GET", url: "/dishes" })).json() as { id: string }[]).map((x) => x.id);

async function omelette() {
  const ctx = setup();
  const white = await ctx.products.add(item("Egg white"));
  const egg = await ctx.products.add(item("Egg", { piece_weight: 50 }));
  const made = await create(ctx.app, "omelette", [
    { product_id: white.id, grams: 100 },
    { product_id: egg.id, pieces: 2 },
  ]);
  return { ...ctx, white, egg, dish: made.json() as { id: string } };
}

describe("editDish", () => {
  // cites: REQ-006/AC-009, R-008
  it("records a new dish when an amount changes and leaves the old dish unchanged", async () => {
    const { app, white, egg, dish } = await omelette();
    const res = await patch(app, dish.id, {
      lines: [
        { product_id: white.id, grams: 150 },
        { product_id: egg.id, pieces: 2 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.versioned).toBe(true);
    expect(body.replaced_id).toBe(dish.id);
    expect(body.dish.id).not.toBe(dish.id);
    expect(body.dish.name).toBe("omelette");
    expect(body.dish.lines[0]).toMatchObject({ grams: 150 });
    const old = (await read(app, dish.id)).json();
    expect(old.lines[0]).toMatchObject({ grams: 100 });
    expect(old).toMatchObject({ name: "omelette", replaced_by: body.dish.id, selectable: false });
  });

  // cites: REQ-006/AC-009, R-008
  it("records a new dish when the order of the lines changes", async () => {
    const { app, white, egg, dish } = await omelette();
    const res = await patch(app, dish.id, {
      lines: [
        { product_id: egg.id, pieces: 2 },
        { product_id: white.id, grams: 100 },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().dish.lines.map((l: { product: { id: string } }) => l.product.id)).toEqual([egg.id, white.id]);
  });

  // cites: REQ-006/AC-009, R-008
  it("records a new dish when a product is added, with a new name given too", async () => {
    const { app, white, products, dish } = await omelette();
    const milk = await products.add(item("Milk"));
    const res = await patch(app, dish.id, {
      name: "white omelette",
      lines: [
        { product_id: white.id, grams: 100 },
        { product_id: milk.id, grams: 50 },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().dish).toMatchObject({ name: "white omelette" });
    expect(res.json().dish.lines).toHaveLength(2);
    expect((await read(app, dish.id)).json().name).toBe("omelette");
  });

  // cites: REQ-006/AC-010, R-008
  it("keeps the old id readable for a past reference and lists only the new dish for the next plan", async () => {
    const { app, white, egg, dish } = await omelette();
    const res = await patch(app, dish.id, { lines: [{ product_id: white.id, grams: 120 }] });
    const created = res.json().dish as { id: string };
    const past = await read(app, dish.id);
    expect(past.statusCode).toBe(200);
    expect(past.json().lines).toHaveLength(2);
    expect(past.json().lines[1].product.id).toBe(egg.id);
    expect(await listed(app)).toEqual([created.id]);
  });

  // cites: R-008
  it("applies a name-only change in place with the same id", async () => {
    const { app, dish } = await omelette();
    const res = await patch(app, dish.id, { name: "  big omelette " });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ versioned: false, replaced_id: null });
    expect(res.json().dish).toMatchObject({ id: dish.id, name: "big omelette", replaced_by: null });
    expect(await listed(app)).toEqual([dish.id]);
  });

  // cites: R-008
  it("records nothing when the request changes nothing", async () => {
    const { app, white, egg, dish } = await omelette();
    const res = await patch(app, dish.id, {
      name: "omelette",
      lines: [
        { product_id: white.id, grams: 100 },
        { product_id: egg.id, pieces: 2 },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ versioned: false, replaced_id: null });
    expect(res.json().dish.id).toBe(dish.id);
    expect(await listed(app)).toEqual([dish.id]);
  });

  // cites: IF-001@1.3.0#editDish, R-007
  it("refuses a blank name or no lines with dish.values_missing", async () => {
    const { app, white, dish } = await omelette();
    const blank = await patch(app, dish.id, { name: "   " });
    expect(blank.statusCode).toBe(422);
    expect(blank.json()).toMatchObject({ code: "dish.values_missing", missing: ["name"] });
    const none = await patch(app, dish.id, { name: "x", lines: [] });
    expect(none.statusCode).toBe(422);
    expect(none.json()).toMatchObject({ code: "dish.values_missing", missing: ["lines"] });
    expect(await listed(app)).toEqual([dish.id]);
    expect((await read(app, dish.id)).json().lines[0].product.id).toBe(white.id);
  });

  // cites: IF-001@1.3.0#editDish, R-007
  it("refuses bad lines with their indexes and reasons and saves nothing", async () => {
    const { app, white, dish } = await omelette();
    const res = await patch(app, dish.id, {
      lines: [{ product_id: white.id, grams: 100 }, { product_id: "nope", grams: 5 }, { product_id: white.id, pieces: 1 }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "dish.line_invalid",
      lines: [
        { index: 1, reason: "product_not_found" },
        { index: 2, reason: "piece_without_weight" },
      ],
    });
    expect(await listed(app)).toEqual([dish.id]);
  });

  // cites: IF-001@1.3.0#editDish, ADR-014
  it("refuses a new line with a deleted product but keeps an unchanged line with one", async () => {
    const { app, products, white, egg, dish } = await omelette();
    const gone = await products.add(item("Gone"));
    await products.softDelete(egg.id, NOW);
    await products.softDelete(gone.id, NOW);
    const refused = await patch(app, dish.id, { lines: [{ product_id: gone.id, grams: 5 }] });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().lines).toEqual([{ index: 0, reason: "product_not_selectable" }]);
    const kept = await patch(app, dish.id, {
      lines: [
        { product_id: white.id, grams: 80 },
        { product_id: egg.id, pieces: 2 },
      ],
    });
    expect(kept.statusCode).toBe(201);
    expect(kept.json().dish.lines[1].product.id).toBe(egg.id);
  });

  // cites: IF-001@1.3.0#editDish
  it("answers dish.not_selectable for a replaced or deleted dish and dish.not_found for an unknown id", async () => {
    const { app, white, dish } = await omelette();
    const edited = await patch(app, dish.id, { lines: [{ product_id: white.id, grams: 1 }] });
    const replaced = await patch(app, dish.id, { name: "again" });
    expect(replaced.statusCode).toBe(409);
    expect(replaced.json().code).toBe("dish.not_selectable");
    await app.inject({ method: "DELETE", url: `/dishes/${edited.json().dish.id}` });
    const deleted = await patch(app, edited.json().dish.id, { name: "again" });
    expect(deleted.statusCode).toBe(409);
    const unknown = await patch(app, "missing", { name: "x" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe("dish.not_found");
  });

  // cites: IF-001@1.3.0#editDish
  it("refuses an empty body, an unknown field and a wrong type with request.invalid", async () => {
    const { app, dish } = await omelette();
    for (const payload of [{}, { colour: "red" }, { name: 5 }, { lines: "x" }]) {
      const res = await patch(app, dish.id, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("request.invalid");
    }
  });

  // cites: IF-001@1.3.0#editDish
  it("refuses a request without an Owner session", async () => {
    const products = new InMemoryProductStore(() => "p-1");
    const app = buildApp({ store: products, dishStore: new InMemoryDishStore(() => "d-1") });
    const res = await patch(app, "d-1", { name: "x" });
    expect(res.statusCode).toBe(401);
  });
});
