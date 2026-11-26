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
const planAdd = (ctx: Ctx, date: string, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: "POST", url: `/days/${date}/plan/entries`, payload });
const logAdd = (ctx: Ctx, date: string, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: "POST", url: `/days/${date}/log/entries`, payload });
const logGet = (ctx: Ctx, date: string) => ctx.app.inject({ method: "GET", url: `/days/${date}/log` });
const confirm = (ctx: Ctx, date: string, meal: string) =>
  ctx.app.inject({ method: "POST", url: `/days/${date}/log/meals/${meal}/confirm` });
const logRows = async (ctx: Ctx, date: string) => (await ctx.plans.read(date, "log")).entries;

describe("confirm a meal as planned", () => {
  // cites: REQ-014/AC-001, IF-001@1.5.0#confirmMealAsPlanned
  it("copies 100 g rice and 150 g chicken of the lunch plan into the lunch log", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const chicken = await ctx.products.add(item("Chicken"));
    await planAdd(ctx, TODAY, { meal: "lunch", product_id: rice.id, grams: 100 });
    await planAdd(ctx, TODAY, { meal: "lunch", product_id: chicken.id, grams: 150 });
    const res = await confirm(ctx, TODAY, "lunch");
    expect(res.statusCode).toBe(201);
    expect(res.json().entries.map((x: { product: { id: string }; grams: number }) => [x.product.id, x.grams])).toEqual([
      [rice.id, 100],
      [chicken.id, 150],
    ]);
    const rows = await logRows(ctx, TODAY);
    expect(rows.map((x) => [x.meal, x.product_id, x.grams])).toEqual([
      ["lunch", rice.id, 100],
      ["lunch", chicken.id, 150],
    ]);
  });

  // cites: REQ-014/AC-002, IF-001@1.5.0#changeLogEntry
  it("loads the plan as actual, changes rice to 80 g, and leaves the plan at 100 g", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    await planAdd(ctx, TODAY, { meal: "lunch", product_id: rice.id, grams: 100 });
    const copy = (await confirm(ctx, TODAY, "lunch")).json().entries[0];
    const res = await ctx.app.inject({ method: "PATCH", url: `/days/${TODAY}/log/entries/${copy.id}`, payload: { grams: 80 } });
    expect(res.statusCode).toBe(200);
    expect((await logRows(ctx, TODAY))[0]?.grams).toBe(80);
    expect((await ctx.plans.read(TODAY)).entries[0]?.grams).toBe(100);
  });

  // cites: REQ-014/AC-013, IF-001@1.5.0#getDayLog
  it("says which meals have a plan, so the button shows for breakfast and not for lunch", async () => {
    const ctx = setup();
    const oats = await ctx.products.add(item("Oatmeal"));
    await planAdd(ctx, TODAY, { meal: "breakfast", product_id: oats.id, grams: 50 });
    const body = (await logGet(ctx, TODAY)).json();
    const byMeal = (m: string) => body.meals.find((x: { meal: string }) => x.meal === m);
    expect(body).toMatchObject({ kind: "log", date: TODAY, today: TODAY, closed: false, editable: true });
    expect(body.meals.map((x: { meal: string }) => x.meal)).toEqual(["breakfast", "brunch", "lunch", "afternoon_snack", "dinner"]);
    expect(byMeal("breakfast").has_plan).toBe(true);
    expect(byMeal("lunch").has_plan).toBe(false);
  });

  // cites: IF-001@1.5.0#confirmMealAsPlanned, A-037
  it("refuses a meal with no plan with plan.meal_empty, and a meal already logged with log.meal_not_empty", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const empty = await confirm(ctx, TODAY, "lunch");
    expect(empty.statusCode).toBe(409);
    expect(empty.json().code).toBe("plan.meal_empty");
    await planAdd(ctx, TODAY, { meal: "dinner", product_id: rice.id, grams: 100 });
    await logAdd(ctx, TODAY, { meal: "dinner", product_id: rice.id, grams: 30 });
    const again = await confirm(ctx, TODAY, "dinner");
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("log.meal_not_empty");
    expect((await logRows(ctx, TODAY)).map((x) => x.grams)).toEqual([30]);
  });
});

describe("log entries", () => {
  // cites: REQ-014/AC-003, IF-001@1.5.0#addLogEntry
  it("logs lunch from scratch with 200 g soup and holds only that", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const soup = await ctx.products.add(item("Soup"));
    await planAdd(ctx, TODAY, { meal: "lunch", product_id: rice.id, grams: 100 });
    const res = await logAdd(ctx, TODAY, { meal: "lunch", product_id: soup.id, grams: 200 });
    expect(res.statusCode).toBe(201);
    expect((await logRows(ctx, TODAY)).map((x) => [x.product_id, x.grams])).toEqual([[soup.id, 200]]);
  });

  // cites: REQ-014/AC-004, R-007, IF-001@1.5.0#addLogEntry
  it("logs a whole dish portion at dinner", async () => {
    const ctx = setup();
    const egg = await ctx.products.add(item("Egg"));
    const dish = await ctx.dishes.add({ name: "omelette", lines: [{ product_id: egg.id, grams: 100, pieces: null }] }, NOON);
    const res = await logAdd(ctx, TODAY, { meal: "dinner", dish_id: dish.dish.id });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ meal: "dinner", dish: { id: dish.dish.id }, product: null, grams: null, pieces: null });
  });

  // cites: REQ-014/AC-005, IF-001@1.5.0#addLogEntry
  it("logs the products of a dish that is not in the catalog one by one, each with its amount", async () => {
    const ctx = setup();
    const pasta = await ctx.products.add(item("Pasta"));
    const sauce = await ctx.products.add(item("Sauce"));
    await logAdd(ctx, TODAY, { meal: "dinner", product_id: pasta.id, grams: 80 });
    await logAdd(ctx, TODAY, { meal: "dinner", product_id: sauce.id, grams: 60 });
    expect((await logRows(ctx, TODAY)).map((x) => [x.product_id, x.grams])).toEqual([
      [pasta.id, 80],
      [sauce.id, 60],
    ]);
  });

  // cites: REQ-014/AC-006, IF-001@1.5.0#addLogEntry
  it("saves 50 g chocolate at breakfast when the plan holds only oatmeal, with no warning", async () => {
    const ctx = setup();
    const oats = await ctx.products.add(item("Oatmeal"));
    const chocolate = await ctx.products.add(item("Chocolate"));
    await planAdd(ctx, TODAY, { meal: "breakfast", product_id: oats.id, grams: 50 });
    const res = await logAdd(ctx, TODAY, { meal: "breakfast", product_id: chocolate.id, grams: 50 });
    expect(res.statusCode).toBe(201);
    expect(Object.keys(res.json())).not.toContain("warning");
  });

  // cites: REQ-014/AC-007, IF-001@1.5.0#addLogEntry
  it("keeps an apple planned for brunch at lunch when logged at lunch", async () => {
    const ctx = setup();
    const apple = await ctx.products.add(item("Apple"));
    await planAdd(ctx, TODAY, { meal: "brunch", product_id: apple.id, grams: 100 });
    const res = await logAdd(ctx, TODAY, { meal: "lunch", product_id: apple.id, grams: 100 });
    expect(res.json().meal).toBe("lunch");
    expect((await logRows(ctx, TODAY)).map((x) => x.meal)).toEqual(["lunch"]);
  });

  // cites: REQ-014/AC-008, R-007, IF-001@1.5.0#addLogEntry
  it("weighs 2 eggs of 50 g at 100 g with nutrients from the egg product", async () => {
    const ctx = setup();
    const egg = await ctx.products.add(item("Egg", { piece_weight: 50, calories: 143 }));
    const res = await logAdd(ctx, TODAY, { meal: "breakfast", product_id: egg.id, pieces: 2 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ pieces: 2, grams: null, weight_grams: 100, product: { id: egg.id, calories: 143 } });
  });

  // cites: REQ-014/AC-009, R-007, IF-001@1.5.0#addLogEntry
  it("refuses pieces for a product without a piece weight and saves nothing", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const res = await logAdd(ctx, TODAY, { meal: "lunch", product_id: rice.id, pieces: 2 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "entry.invalid", reasons: ["piece_without_weight"] });
    expect(await logRows(ctx, TODAY)).toHaveLength(0);
  });

  // cites: IF-001@1.5.0#removeLogEntry, IF-001@1.5.0#changeLogEntry
  it("removes only log entries, and an id of the plan is not found in the log", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const planned = (await planAdd(ctx, TODAY, { meal: "lunch", product_id: rice.id, grams: 100 })).json();
    const logged = (await logAdd(ctx, TODAY, { meal: "lunch", product_id: rice.id, grams: 90 })).json();
    const miss = await ctx.app.inject({ method: "DELETE", url: `/days/${TODAY}/log/entries/${planned.id}` });
    expect(miss.json().code).toBe("entry.not_found");
    const gone = await ctx.app.inject({ method: "DELETE", url: `/days/${TODAY}/log/entries/${logged.id}` });
    expect(gone.statusCode).toBe(204);
    expect(await logRows(ctx, TODAY)).toHaveLength(0);
    expect((await ctx.plans.read(TODAY)).entries).toHaveLength(1);
  });
});

describe("log window, closed day and session", () => {
  // cites: IF-001@1.5.0#addLogEntry, A-035
  it("takes an earlier day and today, and refuses a day after today with log.day_out_of_range", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const body = { meal: "lunch", product_id: rice.id, grams: 100 };
    expect((await logAdd(ctx, "2026-01-10", body)).statusCode).toBe(201);
    expect((await logAdd(ctx, TODAY, body)).statusCode).toBe(201);
    const late = await logAdd(ctx, "2026-01-16", body);
    expect(late.statusCode).toBe(422);
    expect(late.json().code).toBe("log.day_out_of_range");
    expect(await logRows(ctx, "2026-01-16")).toHaveLength(0);
    expect((await confirm(ctx, "2026-01-16", "lunch")).json().code).toBe("log.day_out_of_range");
    expect((await logGet(ctx, "2026-01-16")).json()).toMatchObject({ editable: false });
  });

  // cites: REQ-014/AC-011, R-013, IF-001@1.5.0#addLogEntry
  it("refuses add, change, remove and confirm on a closed day with day.closed and saves nothing", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    await planAdd(ctx, TODAY, { meal: "dinner", product_id: rice.id, grams: 100 });
    const entry = (await logAdd(ctx, TODAY, { meal: "lunch", product_id: rice.id, grams: 100 })).json();
    ctx.plans.seedClosed(TODAY);
    const calls = [
      logAdd(ctx, TODAY, { meal: "breakfast", product_id: rice.id, grams: 50 }),
      ctx.app.inject({ method: "PATCH", url: `/days/${TODAY}/log/entries/${entry.id}`, payload: { grams: 1 } }),
      ctx.app.inject({ method: "DELETE", url: `/days/${TODAY}/log/entries/${entry.id}` }),
      confirm(ctx, TODAY, "dinner"),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("day.closed");
    }
    expect((await logRows(ctx, TODAY)).map((x) => x.grams)).toEqual([100]);
    expect((await logGet(ctx, TODAY)).json()).toMatchObject({ closed: true, editable: false });
  });

  // cites: IF-001@1.5.0#getDayLog, IF-001@1.5.0#addLogEntry, IF-001@1.5.0#changeLogEntry, IF-001@1.5.0#removeLogEntry, IF-001@1.5.0#confirmMealAsPlanned
  it("requires the Owner session on every log route", async () => {
    const ctx = setup(false);
    const calls = [
      ctx.app.inject({ method: "GET", url: `/days/${TODAY}/log` }),
      ctx.app.inject({ method: "POST", url: `/days/${TODAY}/log/entries`, payload: { meal: "lunch" } }),
      ctx.app.inject({ method: "PATCH", url: `/days/${TODAY}/log/entries/x`, payload: { grams: 1 } }),
      ctx.app.inject({ method: "DELETE", url: `/days/${TODAY}/log/entries/x` }),
      confirm(ctx, TODAY, "lunch"),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("auth.required");
    }
  });
});
