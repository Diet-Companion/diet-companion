import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryDishStore } from "./in-memory-dish-store.js";
import { InMemoryPlanStore } from "./in-memory-plan-store.js";
import { InMemoryProductStore, type NewProduct } from "./products.js";

const ZONE = "Europe/Rome";
// Noon in Rome on 2026-01-15 (winter, UTC+1): today is 2026-01-15.
const NOON = new Date("2026-01-15T11:00:00.000Z");
const TODAY = "2026-01-15";

function setup(owner = true) {
  let p = 0;
  let d = 0;
  let e = 0;
  const products = new InMemoryProductStore(() => `p-${++p}`);
  const dishes = new InMemoryDishStore(() => `d-${++d}`);
  const plans = new InMemoryPlanStore(() => `e-${++e}`);
  const app = buildApp({
    store: products,
    dishStore: dishes,
    planStore: plans,
    isOwner: owner ? () => true : undefined,
    clock: () => NOON,
    timeZone: ZONE,
  });
  return { app, products, dishes, plans };
}

type Ctx = ReturnType<typeof setup>;
const item = (name: string, extra: Partial<NewProduct> = {}): NewProduct => ({
  name,
  shop: "Shop A",
  calories: 100,
  protein: 1,
  fat: 1,
  source: "manual",
  ...extra,
});
const split = (ctx: Ctx, date: string, payload: unknown) =>
  ctx.app.inject({ method: "POST", url: `/days/${date}/log/dish-products`, payload: payload as Record<string, unknown> });
const logRows = async (ctx: Ctx, date: string) => (await ctx.plans.read(date, "log")).entries;

/** The omelette of REQ-014/AC-010: 100 g egg white and 2 eggs of 50 g. */
async function omelette(ctx: Ctx) {
  const white = await ctx.products.add(item("Egg white"));
  const egg = await ctx.products.add(item("Egg", { piece_weight: 50 }));
  const dish = await ctx.dishes.add(
    {
      name: "omelette",
      lines: [
        { product_id: white.id, grams: 100, pieces: null },
        { product_id: egg.id, grams: null, pieces: 2 },
      ],
    },
    NOON,
  );
  return { white, egg, dish };
}

describe("addLogDishProducts", () => {
  // cites: REQ-014/AC-010, REQ-006/AC-007, IF-001@1.5.0#addLogDishProducts
  it("logs the omelette as 150 g egg white and 2 eggs and leaves the catalog dish at 100 g egg white", async () => {
    const ctx = setup();
    const { white, egg, dish } = await omelette(ctx);
    const res = await split(ctx, TODAY, { meal: "dinner", dish_id: dish.dish.id, lines: [{ position: 0, grams: 150 }] });
    expect(res.statusCode).toBe(201);
    expect(res.json().entries.map((x: { product: { id: string }; grams: number | null; pieces: number | null }) => [x.product.id, x.grams, x.pieces])).toEqual([
      [white.id, 150, null],
      [egg.id, null, 2],
    ]);
    expect((await logRows(ctx, TODAY)).map((x) => [x.meal, x.product_id, x.grams, x.pieces])).toEqual([
      ["dinner", white.id, 150, null],
      ["dinner", egg.id, null, 2],
    ]);
    const stored = await ctx.dishes.get(dish.dish.id);
    expect(stored?.dish.lines.map((l) => [l.product_id, l.grams, l.pieces])).toEqual([
      [white.id, 100, null],
      [egg.id, null, 2],
    ]);
  });

  // cites: REQ-014/AC-005, IF-001@1.5.0#addLogDishProducts
  it("saves one product entry per dish line with the amount of the line when nothing is overridden", async () => {
    const ctx = setup();
    const pasta = await ctx.products.add(item("Pasta"));
    const sauce = await ctx.products.add(item("Sauce"));
    const dish = await ctx.dishes.add(
      {
        name: "pasta with sauce",
        lines: [
          { product_id: pasta.id, grams: 80, pieces: null },
          { product_id: sauce.id, grams: 60, pieces: null },
        ],
      },
      NOON,
    );
    const res = await split(ctx, TODAY, { meal: "dinner", dish_id: dish.dish.id });
    expect(res.statusCode).toBe(201);
    expect((await logRows(ctx, TODAY)).map((x) => [x.product_id, x.grams])).toEqual([
      [pasta.id, 80],
      [sauce.id, 60],
    ]);
  });

  // cites: IF-001@1.5.0#addLogDishProducts, ADR-018/C-001
  it("sets from_dish_id to the dish and writes in the order of the dish lines, whatever the order of the overrides", async () => {
    const ctx = setup();
    const a = await ctx.products.add(item("Rice"));
    const b = await ctx.products.add(item("Chicken"));
    const c = await ctx.products.add(item("Soup"));
    const dish = await ctx.dishes.add(
      {
        name: "bowl",
        lines: [
          { product_id: a.id, grams: 100, pieces: null },
          { product_id: b.id, grams: 150, pieces: null },
          { product_id: c.id, grams: 200, pieces: null },
        ],
      },
      NOON,
    );
    const res = await split(ctx, TODAY, {
      meal: "lunch",
      dish_id: dish.dish.id,
      lines: [
        { position: 2, grams: 10 },
        { position: 1, grams: 20 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const rows = await logRows(ctx, TODAY);
    expect(rows.map((x) => [x.product_id, x.grams])).toEqual([
      [a.id, 100],
      [b.id, 20],
      [c.id, 10],
    ]);
    expect(rows.every((x) => x.from_dish_id === dish.dish.id && x.dish_id === null)).toBe(true);
    expect(res.json().entries.map((x: { from_dish_id: string }) => x.from_dish_id)).toEqual([dish.dish.id, dish.dish.id, dish.dish.id]);
  });

  // cites: IF-001@1.5.0#addLogDishProducts, ADR-018/C-001
  it("refuses an unknown or a soft-deleted dish with entry.invalid and saves nothing", async () => {
    const ctx = setup();
    const { dish } = await omelette(ctx);
    const unknown = await split(ctx, TODAY, { meal: "dinner", dish_id: "d-99" });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ code: "entry.invalid", reasons: ["dish_not_found"] });
    await ctx.dishes.softDelete(dish.dish.id, NOON);
    const deleted = await split(ctx, TODAY, { meal: "dinner", dish_id: dish.dish.id });
    expect(deleted.statusCode).toBe(400);
    expect(deleted.json()).toMatchObject({ code: "entry.invalid", reasons: ["dish_not_selectable"] });
    expect(await logRows(ctx, TODAY)).toHaveLength(0);
  });

  // cites: IF-001@1.5.0#addLogDishProducts, R-007
  it("refuses bad overrides with the refused lines by index and saves nothing", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const chicken = await ctx.products.add(item("Chicken"));
    const soup = await ctx.products.add(item("Soup"));
    const dish = await ctx.dishes.add(
      {
        name: "bowl",
        lines: [
          { product_id: rice.id, grams: 100, pieces: null },
          { product_id: chicken.id, grams: 150, pieces: null },
          { product_id: soup.id, grams: 200, pieces: null },
        ],
      },
      NOON,
    );
    const res = await split(ctx, TODAY, {
      meal: "lunch",
      dish_id: dish.dish.id,
      lines: [
        { position: 0, grams: 0 },
        { position: 1, grams: 1, pieces: 1 },
        { position: 9, grams: 5 },
        { position: 2, pieces: 2 },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "entry.invalid",
      lines: [
        { index: 0, reason: "amount_invalid" },
        { index: 1, reason: "amount_invalid" },
        { index: 2, reason: "line_unknown" },
        { index: 3, reason: "piece_without_weight" },
      ],
    });
    expect(await logRows(ctx, TODAY)).toHaveLength(0);
  });

  // cites: IF-001@1.5.0#addLogDishProducts
  it("refuses a malformed body with request.invalid", async () => {
    const ctx = setup();
    const { dish } = await omelette(ctx);
    const bodies = [
      { dish_id: dish.dish.id },
      { meal: "dinner" },
      { meal: "snack", dish_id: dish.dish.id },
      { meal: "dinner", dish_id: dish.dish.id, extra: 1 },
      { meal: "dinner", dish_id: dish.dish.id, lines: "x" },
      { meal: "dinner", dish_id: dish.dish.id, lines: [{ grams: 5 }] },
      { meal: "dinner", dish_id: dish.dish.id, lines: [{ position: 0, grams: 5 }, { position: 0, grams: 6 }] },
    ];
    for (const payload of bodies) {
      const res = await split(ctx, TODAY, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("request.invalid");
    }
    expect(await logRows(ctx, TODAY)).toHaveLength(0);
  });

  // cites: IF-001@1.5.0#addLogDishProducts, A-035
  it("takes an earlier day and refuses a day after today with log.day_out_of_range", async () => {
    const ctx = setup();
    const { dish } = await omelette(ctx);
    const body = { meal: "dinner", dish_id: dish.dish.id };
    expect((await split(ctx, "2026-01-10", body)).statusCode).toBe(201);
    const late = await split(ctx, "2026-01-16", body);
    expect(late.statusCode).toBe(422);
    expect(late.json().code).toBe("log.day_out_of_range");
    expect(await logRows(ctx, "2026-01-16")).toHaveLength(0);
  });

  // cites: REQ-014/AC-011, R-013, IF-001@1.5.0#addLogDishProducts
  it("refuses a closed day with day.closed and saves nothing", async () => {
    const ctx = setup();
    const { dish } = await omelette(ctx);
    ctx.plans.seedClosed(TODAY);
    const res = await split(ctx, TODAY, { meal: "dinner", dish_id: dish.dish.id });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("day.closed");
    expect(await logRows(ctx, TODAY)).toHaveLength(0);
  });

  // cites: IF-001@1.5.0#addLogDishProducts
  it("requires the Owner session", async () => {
    const ctx = setup(false);
    const res = await split(ctx, TODAY, { meal: "dinner", dish_id: "d-1" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("auth.required");
  });
});
