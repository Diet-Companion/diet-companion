import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryDishStore } from "./in-memory-dish-store.js";
import { InMemoryPlanStore } from "./in-memory-plan-store.js";
import { InMemoryProductStore, type NewProduct } from "./products.js";
import { InMemoryTargetStore } from "./target-store.js";

const ZONE = "Europe/Rome";
// Noon in Rome on 2026-01-15 (winter, UTC+1): today is 2026-01-15.
const NOON = new Date("2026-01-15T11:00:00.000Z");
const TODAY = "2026-01-15";
const PAST = "2026-01-12";
const MEAL_NAMES = ["breakfast", "brunch", "lunch", "afternoon_snack", "dinner"];

interface Totals {
  calories: number;
  protein: number;
  fat: number;
}
interface Nutrient {
  nutrient: string;
  total: number;
  minimum: number | null;
  maximum: number | null;
  status: string;
  signed_number: string | null;
}
interface Sheet {
  closed: boolean;
  meals: { meal: string; totals: Totals }[];
  result: { ranges_source: string; nutrients: Nutrient[] };
}

// Synthetic product, per 100 g: 500 kcal, 10 g protein, 5 g fat.
const OAT: NewProduct = { name: "Oat", shop: "Shop A", calories: 500, protein: 10, fat: 5, source: "manual" };

async function setup() {
  let e = 0;
  const clock = { now: NOON };
  const products = new InMemoryProductStore(() => "p-1");
  const plans = new InMemoryPlanStore(() => `e-${++e}`);
  const targets = new InMemoryTargetStore();
  const app = buildApp({
    store: products,
    dishStore: new InMemoryDishStore(() => "d-1"),
    planStore: plans,
    targetStore: targets,
    isOwner: () => true,
    clock: () => clock.now,
    timeZone: ZONE,
  });
  await targets.save({ nutrient: "calories", minimum: 1800, maximum: 2200, effective_from: "2026-01-10" });
  const oat = await products.add(OAT);
  return { app, products, plans, targets, clock, oat };
}

type Ctx = Awaited<ReturnType<typeof setup>>;
const logAdd = (ctx: Ctx, date: string, meal: string, grams: number) =>
  ctx.app.inject({ method: "POST", url: `/days/${date}/log/entries`, payload: { meal, product_id: ctx.oat.id, grams } });
const planAdd = (ctx: Ctx, date: string, meal: string, grams: number) =>
  ctx.app.inject({ method: "POST", url: `/days/${date}/plan/entries`, payload: { meal, product_id: ctx.oat.id, grams } });
const sheet = async (ctx: Ctx, kind: "plan" | "log", date: string): Promise<Sheet> =>
  (await ctx.app.inject({ method: "GET", url: `/days/${date}/${kind}` })).json() as Sheet;
const close = (ctx: Ctx, date: string) => ctx.app.inject({ method: "POST", url: `/days/${date}/close` });
const mealTotals = (s: Sheet, meal: string): Totals | undefined => s.meals.find((m) => m.meal === meal)?.totals;
const calories = (s: Sheet): Nutrient => s.result.nutrients[0] as Nutrient;

describe("day result and meal totals", () => {
  // cites: REQ-010/AC-024
  it("shows a partly logged day against the ranges, with the plan and the log each from its own entries", async () => {
    const ctx = await setup();
    await planAdd(ctx, TODAY, "breakfast", 200);
    await planAdd(ctx, TODAY, "lunch", 200);
    await logAdd(ctx, TODAY, "breakfast", 200);
    const plan = await sheet(ctx, "plan", TODAY);
    const log = await sheet(ctx, "log", TODAY);
    expect(calories(plan)).toMatchObject({ total: 2000, minimum: 1800, maximum: 2200, status: "green", signed_number: "-200" });
    expect(calories(log)).toMatchObject({ total: 1000, status: "yellow", signed_number: "-800" });
    expect(mealTotals(log, "breakfast")).toEqual({ calories: 1000, protein: 20, fat: 10 });
    expect(mealTotals(log, "lunch")).toEqual({ calories: 0, protein: 0, fat: 0 });
    expect(mealTotals(plan, "lunch")).toEqual({ calories: 1000, protein: 20, fat: 10 });
  });

  // cites: REQ-010/AC-007
  it("never adds the plan to a log total", async () => {
    const ctx = await setup();
    await planAdd(ctx, TODAY, "lunch", 400);
    const log = await sheet(ctx, "log", TODAY);
    expect(calories(log).total).toBe(0);
    expect(mealTotals(log, "lunch")).toEqual({ calories: 0, protein: 0, fat: 0 });
  });

  // cites: REQ-010/AC-023
  it("shows a plan over the maximum as red with the amount over, on the plan and the log alike", async () => {
    const ctx = await setup();
    await planAdd(ctx, TODAY, "dinner", 500);
    await logAdd(ctx, TODAY, "dinner", 500);
    expect(calories(await sheet(ctx, "plan", TODAY))).toMatchObject({ total: 2500, status: "red", signed_number: "+300" });
    expect(calories(await sheet(ctx, "log", TODAY))).toMatchObject({ total: 2500, status: "red", signed_number: "+300" });
  });

  // cites: REQ-010/AC-013, REQ-015/AC-010, REQ-015/AC-011
  it("gives meal totals no range, colour or difference, and no warning anywhere, even over the maximum", async () => {
    const ctx = await setup();
    await planAdd(ctx, TODAY, "dinner", 500);
    const res = await ctx.app.inject({ method: "GET", url: `/days/${TODAY}/plan` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Sheet & Record<string, unknown>;
    expect(body.meals.map((m) => m.meal)).toEqual(MEAL_NAMES);
    for (const meal of body.meals) expect(Object.keys(meal.totals).sort()).toEqual(["calories", "fat", "protein"]);
    expect(Object.keys(body).sort()).toEqual(["closed", "closed_at", "date", "editable", "kind", "meals", "result", "today"]);
    const added = await planAdd(ctx, TODAY, "lunch", 100);
    expect(added.statusCode).toBe(201);
  });

  // cites: REQ-010/AC-010
  it("shows a result on an open day from the ranges in force and on a closed day from its stored ranges", async () => {
    const ctx = await setup();
    await logAdd(ctx, TODAY, "lunch", 400);
    const open = await sheet(ctx, "log", TODAY);
    expect(open.result.ranges_source).toBe("in_force");
    expect(calories(open)).toMatchObject({ total: 2000, status: "green" });
    await close(ctx, TODAY);
    const closed = await sheet(ctx, "log", TODAY);
    expect(closed.closed).toBe(true);
    expect(closed.result.ranges_source).toBe("closed_copy");
    expect(closed.result.nutrients).toEqual(open.result.nutrients);
    expect((await sheet(ctx, "plan", TODAY)).result.ranges_source).toBe("closed_copy");
  });
});

describe("closeDay result", () => {
  // cites: REQ-011/AC-001, REQ-011/AC-008
  it("closes an open day today and returns the result, which stays the same when read again", async () => {
    const ctx = await setup();
    await logAdd(ctx, TODAY, "lunch", 200);
    const res = await close(ctx, TODAY);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Sheet;
    expect(body.closed).toBe(true);
    expect(body.result.ranges_source).toBe("closed_copy");
    expect(calories(body)).toMatchObject({ total: 1000, minimum: 1800, maximum: 2200, status: "yellow", signed_number: "-800" });
    expect(mealTotals(body, "lunch")).toEqual({ calories: 1000, protein: 20, fat: 10 });
    expect((await sheet(ctx, "log", TODAY)).result).toEqual(body.result);
  });

  // cites: REQ-011/AC-010
  it("closes a past day with no entries and shows a zero result with zero meal totals", async () => {
    const ctx = await setup();
    const res = await close(ctx, PAST);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Sheet;
    expect(calories(body)).toMatchObject({ total: 0, status: "yellow", signed_number: "-1800" });
    expect(body.result.nutrients.map((n) => n.nutrient)).toEqual(["calories", "protein", "fat"]);
    expect(body.result.nutrients[1]).toMatchObject({ total: 0, status: "no_range", signed_number: null });
    for (const meal of body.meals) expect(meal.totals).toEqual({ calories: 0, protein: 0, fat: 0 });
  });

  // cites: REQ-011/AC-007
  it("changes the result of an open past day after an edit", async () => {
    const ctx = await setup();
    const added = await logAdd(ctx, PAST, "lunch", 200);
    const id = (added.json() as { id: string }).id;
    expect(calories(await sheet(ctx, "log", PAST))).toMatchObject({ total: 1000, status: "yellow" });
    const change = await ctx.app.inject({ method: "PATCH", url: `/days/${PAST}/log/entries/${id}`, payload: { grams: 400 } });
    expect(change.statusCode).toBe(200);
    expect(calories(await sheet(ctx, "log", PAST))).toMatchObject({ total: 2000, status: "green" });
  });

  // cites: REQ-011/AC-003
  it("leaves the result of a closed day unchanged when a write is refused", async () => {
    const ctx = await setup();
    const added = await logAdd(ctx, TODAY, "lunch", 200);
    const id = (added.json() as { id: string }).id;
    const before = await close(ctx, TODAY);
    const add = await logAdd(ctx, TODAY, "dinner", 300);
    const change = await ctx.app.inject({ method: "PATCH", url: `/days/${TODAY}/log/entries/${id}`, payload: { grams: 50 } });
    const remove = await ctx.app.inject({ method: "DELETE", url: `/days/${TODAY}/log/entries/${id}` });
    expect([add.statusCode, change.statusCode, remove.statusCode]).toEqual([409, 409, 409]);
    const after = await sheet(ctx, "log", TODAY);
    expect(after.result).toEqual((before.json() as Sheet).result);
    expect(after.meals.map((m) => m.totals)).toEqual((before.json() as Sheet).meals.map((m) => m.totals));
  });

  // cites: REQ-010/AC-014
  it("keeps the totals and the result of a closed day when a product is edited or the ranges change", async () => {
    const ctx = await setup();
    await logAdd(ctx, TODAY, "lunch", 200);
    await planAdd(ctx, TODAY, "lunch", 200);
    await close(ctx, TODAY);
    const logBefore = await sheet(ctx, "log", TODAY);
    const planBefore = await sheet(ctx, "plan", TODAY);
    const edit = await ctx.app.inject({ method: "PATCH", url: `/products/${ctx.oat.id}`, payload: { calories: 100 } });
    expect(edit.statusCode).toBe(201);
    await ctx.targets.save({ nutrient: "calories", minimum: 100, maximum: 200, effective_from: TODAY });
    const logAfter = await sheet(ctx, "log", TODAY);
    const planAfter = await sheet(ctx, "plan", TODAY);
    expect(logAfter.result).toEqual(logBefore.result);
    expect(planAfter.result).toEqual(planBefore.result);
    expect(logAfter.meals.map((m) => m.totals)).toEqual(logBefore.meals.map((m) => m.totals));
    expect(calories(logAfter)).toMatchObject({ total: 1000, minimum: 1800, maximum: 2200 });
  });
});
