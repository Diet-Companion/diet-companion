import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryDishStore } from "./in-memory-dish-store.js";
import { InMemoryPlanStore } from "./in-memory-plan-store.js";
import { InMemoryProductStore, type NewProduct } from "./products.js";

const ZONE = "Europe/Rome";
// Noon in Rome on 2026-01-15 (winter, UTC+1).
const WINTER_NOON = new Date("2026-01-15T11:00:00.000Z");

function setup(now: Date = WINTER_NOON, owner = true) {
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
    clock: () => now,
    timeZone: ZONE,
  });
  return { app, products, dishes, plans };
}

function item(name: string, extra: Partial<NewProduct> = {}): NewProduct {
  return { name, shop: "Shop A", calories: 100, protein: 1, fat: 1, source: "manual", ...extra };
}

type Ctx = ReturnType<typeof setup>;
const add = (ctx: Ctx, date: string, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: "POST", url: `/days/${date}/plan/entries`, payload });
const plan = (ctx: Ctx, date: string) => ctx.app.inject({ method: "GET", url: `/days/${date}/plan` });
const count = async (ctx: Ctx, date: string): Promise<number> => (await ctx.plans.read(date)).entries.length;
const RICE = { calories: 130 };
const lunchRice = (id: string, grams: number) => ({ meal: "lunch", product_id: id, grams });

describe("day plan entries", () => {
  // cites: REQ-013/AC-001, R-007, IF-001@1.5.0#addPlanEntry
  it("holds a whole dish at breakfast and 100 g rice at lunch", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice", RICE));
    const dish = await ctx.dishes.add({ name: "omelette", lines: [{ product_id: rice.id, grams: 50, pieces: null }] }, WINTER_NOON);
    expect((await add(ctx, "2026-01-16", { meal: "breakfast", dish_id: dish.dish.id })).statusCode).toBe(201);
    expect((await add(ctx, "2026-01-16", lunchRice(rice.id, 100))).statusCode).toBe(201);
    const body = (await plan(ctx, "2026-01-16")).json();
    const byMeal = (m: string) => body.meals.find((x: { meal: string }) => x.meal === m);
    expect(body.meals.map((x: { meal: string }) => x.meal)).toEqual(["breakfast", "brunch", "lunch", "afternoon_snack", "dinner"]);
    expect(byMeal("breakfast").entries[0]).toMatchObject({ dish: { id: dish.dish.id }, product: null, grams: null, pieces: null });
    expect(byMeal("lunch").entries[0]).toMatchObject({ product: { id: rice.id }, grams: 100, pieces: null });
    expect(byMeal("breakfast").has_plan).toBe(true);
    expect(byMeal("dinner").has_plan).toBe(false);
  });

  // cites: REQ-013/AC-002, IF-001@1.5.0#addPlanEntry
  it("saves a plan for the next day while today is open", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const res = await add(ctx, "2026-01-16", lunchRice(rice.id, 100));
    expect(res.statusCode).toBe(201);
    expect(await count(ctx, "2026-01-16")).toBe(1);
  });

  // cites: REQ-013/AC-003, R-013, IF-001@1.5.0#addPlanEntry
  it("is not blocked by an open earlier day", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    ctx.plans.seedClosed("2026-01-10");
    expect((await add(ctx, "2026-01-16", lunchRice(rice.id, 100))).statusCode).toBe(201);
    expect((await add(ctx, "2026-01-15", lunchRice(rice.id, 100))).statusCode).toBe(201);
  });

  // cites: REQ-013/AC-004, IF-001@1.5.0#addPlanEntry
  it("refuses D+2 and earlier days with plan.day_out_of_range", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    for (const date of ["2026-01-17", "2026-01-14"]) {
      const res = await add(ctx, date, lunchRice(rice.id, 100));
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("plan.day_out_of_range");
      expect(await count(ctx, date)).toBe(0);
    }
  });

  // cites: REQ-013/AC-004, IF-001@1.5.0#getDayPlan
  it("reads the plan of any day, and says it is not editable out of the window", async () => {
    const ctx = setup();
    const far = await plan(ctx, "2026-03-01");
    expect(far.statusCode).toBe(200);
    expect(far.json()).toMatchObject({ kind: "plan", date: "2026-03-01", today: "2026-01-15", closed: false, editable: false });
    expect((await plan(ctx, "2026-01-16")).json().editable).toBe(true);
  });

  // cites: REQ-013/AC-002, REQ-013/AC-004, IF-001@1.5.0#addPlanEntry
  it("moves the window at local midnight in winter (UTC+1)", async () => {
    // 23:30 in Rome is 22:30 UTC: today is still 2026-01-15, so 2026-01-17 is out of range.
    const before = setup(new Date("2026-01-15T22:30:00.000Z"));
    const rice = await before.products.add(item("Rice"));
    expect((await add(before, "2026-01-17", lunchRice(rice.id, 100))).statusCode).toBe(422);
    // 00:30 in Rome is 23:30 UTC the day before: today is 2026-01-16, so 2026-01-17 is now allowed.
    const after = setup(new Date("2026-01-15T23:30:00.000Z"));
    const rice2 = await after.products.add(item("Rice"));
    expect((await add(after, "2026-01-17", lunchRice(rice2.id, 100))).statusCode).toBe(201);
    expect((await add(after, "2026-01-15", lunchRice(rice2.id, 100))).statusCode).toBe(422);
  });

  // cites: REQ-013/AC-002, REQ-013/AC-004, IF-001@1.5.0#addPlanEntry
  it("moves the window at local midnight in summer (UTC+2)", async () => {
    // 23:30 in Rome is 21:30 UTC: today is still 2026-07-15.
    const before = setup(new Date("2026-07-15T21:30:00.000Z"));
    const rice = await before.products.add(item("Rice"));
    expect((await add(before, "2026-07-17", lunchRice(rice.id, 100))).statusCode).toBe(422);
    // 00:30 in Rome is 22:30 UTC the day before: today is 2026-07-16.
    const after = setup(new Date("2026-07-15T22:30:00.000Z"));
    const rice2 = await after.products.add(item("Rice"));
    expect((await add(after, "2026-07-17", lunchRice(rice2.id, 100))).statusCode).toBe(201);
    expect((await add(after, "2026-07-15", lunchRice(rice2.id, 100))).statusCode).toBe(422);
  });

  // cites: REQ-013/AC-005, IF-001@1.5.0#addPlanEntry
  it("accepts 150 g", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const res = await add(ctx, "2026-01-15", { meal: "dinner", product_id: rice.id, grams: 150 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ grams: 150, pieces: null, weight_grams: 150 });
  });

  // cites: REQ-013/AC-006, A-008, IF-001@1.5.0#addPlanEntry
  it("refuses 150.5 g and leaves the plan unchanged", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const res = await add(ctx, "2026-01-15", { meal: "dinner", product_id: rice.id, grams: 150.5 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "entry.invalid", reasons: ["amount_invalid"] });
    expect(await count(ctx, "2026-01-15")).toBe(0);
  });

  // cites: REQ-013/AC-008, R-007, IF-001@1.5.0#addPlanEntry
  it("refuses pieces for a product without a piece weight and saves nothing", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const res = await add(ctx, "2026-01-15", { meal: "lunch", product_id: rice.id, pieces: 2 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "entry.invalid", reasons: ["piece_without_weight"] });
    expect(await count(ctx, "2026-01-15")).toBe(0);
  });

  // cites: REQ-013/AC-008, R-007, IF-001@1.5.0#addPlanEntry
  it("accepts pieces for a product with a piece weight", async () => {
    const ctx = setup();
    const egg = await ctx.products.add(item("Egg", { piece_weight: 50 }));
    const res = await add(ctx, "2026-01-15", { meal: "breakfast", product_id: egg.id, pieces: 2 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ grams: null, pieces: 2, weight_grams: 100 });
  });

  // cites: IF-001@1.5.0#addPlanEntry, ADR-014/C-001
  it("refuses a product that is not selectable, a dish with an amount, and a missing subject", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const dish = await ctx.dishes.add({ name: "x", lines: [{ product_id: rice.id, grams: 10, pieces: null }] }, WINTER_NOON);
    const b = await add(ctx, "2026-01-15", { meal: "lunch", dish_id: dish.dish.id, grams: 5 });
    expect(b.json().reasons).toContain("amount_on_dish");
    const c = await add(ctx, "2026-01-15", { meal: "lunch", grams: 5 });
    expect(c.json().reasons).toEqual(["subject_missing"]);
    ctx.products.seedState(rice.id, { replaced_by: null, deleted_at: WINTER_NOON });
    const a = await add(ctx, "2026-01-15", lunchRice(rice.id, 100));
    expect(a.json().reasons).toEqual(["product_not_selectable"]);
    expect(await count(ctx, "2026-01-15")).toBe(0);
  });

  // cites: IF-001@1.5.0#addPlanEntry
  it("answers request.invalid for a bad date, meal or field", async () => {
    const ctx = setup();
    expect((await add(ctx, "2026-02-30", { meal: "lunch" })).json().code).toBe("request.invalid");
    expect((await add(ctx, "2026-01-15", { meal: "supper" })).json().code).toBe("request.invalid");
    expect((await add(ctx, "2026-01-15", { meal: "lunch", extra: 1 })).json().code).toBe("request.invalid");
  });
});

describe("change and remove", () => {
  async function withEntry() {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const egg = await ctx.products.add(item("Egg", { piece_weight: 50 }));
    const first = (await add(ctx, "2026-01-16", lunchRice(rice.id, 100))).json();
    const second = (await add(ctx, "2026-01-16", { meal: "lunch", product_id: egg.id, pieces: 1 })).json();
    return { ctx, rice, egg, first, second };
  }
  const patch = (ctx: Ctx, date: string, id: string, payload: Record<string, unknown>) =>
    ctx.app.inject({ method: "PATCH", url: `/days/${date}/plan/entries/${id}`, payload });

  // cites: IF-001@1.5.0#changePlanEntry, A-038
  it("changes only the amount and keeps the id, meal, product and position", async () => {
    const { ctx, first, rice } = await withEntry();
    const res = await patch(ctx, "2026-01-16", first.id, { grams: 200 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: first.id, meal: "lunch", position: first.position, grams: 200, product: { id: rice.id } });
  });

  // cites: IF-001@1.5.0#changePlanEntry, REQ-013/AC-006
  it("refuses a fractional or piece amount that does not fit, and keeps the entry", async () => {
    const { ctx, first } = await withEntry();
    expect((await patch(ctx, "2026-01-16", first.id, { grams: 10.5 })).json().reasons).toEqual(["amount_invalid"]);
    expect((await patch(ctx, "2026-01-16", first.id, { pieces: 2 })).json().reasons).toEqual(["piece_without_weight"]);
    expect((await ctx.plans.read("2026-01-16")).entries[0]?.grams).toBe(100);
  });

  // cites: IF-001@1.5.0#changePlanEntry
  it("answers entry.not_found for an unknown id and amount_on_dish for a dish entry", async () => {
    const { ctx, rice } = await withEntry();
    expect((await patch(ctx, "2026-01-16", "nope", { grams: 5 })).json().code).toBe("entry.not_found");
    const dish = await ctx.dishes.add({ name: "x", lines: [{ product_id: rice.id, grams: 10, pieces: null }] }, WINTER_NOON);
    const entry = (await add(ctx, "2026-01-16", { meal: "dinner", dish_id: dish.dish.id })).json();
    expect((await patch(ctx, "2026-01-16", entry.id, { grams: 5 })).json().reasons).toEqual(["amount_on_dish"]);
  });

  // cites: IF-001@1.5.0#removePlanEntry, A-039
  it("removes an entry, and the others keep their ids and order", async () => {
    const { ctx, first, second } = await withEntry();
    const res = await ctx.app.inject({ method: "DELETE", url: `/days/2026-01-16/plan/entries/${first.id}` });
    expect(res.statusCode).toBe(204);
    const left = (await ctx.plans.read("2026-01-16")).entries;
    expect(left.map((e) => e.id)).toEqual([second.id]);
    expect(left[0]?.position).toBe(second.position);
    const again = await ctx.app.inject({ method: "DELETE", url: `/days/2026-01-16/plan/entries/${first.id}` });
    expect(again.json().code).toBe("entry.not_found");
  });

  // cites: IF-001@1.5.0#changePlanEntry, IF-001@1.5.0#removePlanEntry, REQ-013/AC-004
  it("refuses change and remove outside the window", async () => {
    const { ctx, first } = await withEntry();
    expect((await patch(ctx, "2026-01-18", first.id, { grams: 5 })).json().code).toBe("plan.day_out_of_range");
    const res = await ctx.app.inject({ method: "DELETE", url: `/days/2026-01-14/plan/entries/${first.id}` });
    expect(res.statusCode).toBe(422);
  });
});

describe("closed day and session", () => {
  // cites: REQ-013/AC-007, R-013, IF-001@1.5.0#addPlanEntry
  it("refuses add, change and remove on a closed day with day.closed and changes nothing", async () => {
    const ctx = setup();
    const rice = await ctx.products.add(item("Rice"));
    const entry = (await add(ctx, "2026-01-16", lunchRice(rice.id, 100))).json();
    ctx.plans.seedClosed("2026-01-16");
    const a = await add(ctx, "2026-01-16", { meal: "dinner", product_id: rice.id, grams: 50 });
    const c = await ctx.app.inject({ method: "PATCH", url: `/days/2026-01-16/plan/entries/${entry.id}`, payload: { grams: 1 } });
    const r = await ctx.app.inject({ method: "DELETE", url: `/days/2026-01-16/plan/entries/${entry.id}` });
    for (const res of [a, c, r]) {
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("day.closed");
    }
    const read = await plan(ctx, "2026-01-16");
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ closed: true, editable: false });
    expect((await ctx.plans.read("2026-01-16")).entries).toHaveLength(1);
    expect((await ctx.plans.read("2026-01-16")).entries[0]?.grams).toBe(100);
  });

  // cites: IF-001@1.5.0#getDayPlan, IF-001@1.5.0#addPlanEntry, IF-001@1.5.0#changePlanEntry, IF-001@1.5.0#removePlanEntry
  it("requires the Owner session on every route", async () => {
    const ctx = setup(WINTER_NOON, false);
    const calls = [
      ctx.app.inject({ method: "GET", url: "/days/2026-01-15/plan" }),
      ctx.app.inject({ method: "POST", url: "/days/2026-01-15/plan/entries", payload: { meal: "lunch" } }),
      ctx.app.inject({ method: "PATCH", url: "/days/2026-01-15/plan/entries/x", payload: { grams: 1 } }),
      ctx.app.inject({ method: "DELETE", url: "/days/2026-01-15/plan/entries/x" }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("auth.required");
    }
  });
});
