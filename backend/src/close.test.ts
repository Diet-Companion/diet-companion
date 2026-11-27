import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { firstDayOfUse } from "./day-close.js";
import { InMemoryDishStore } from "./in-memory-dish-store.js";
import { InMemoryPlanStore } from "./in-memory-plan-store.js";
import { InMemoryProductStore, type NewProduct } from "./products.js";
import { InMemoryTargetStore, type TargetNutrient } from "./target-store.js";

const ZONE = "Europe/Rome";
// Noon in Rome on 2026-01-15 (winter, UTC+1): today is 2026-01-15 and the day has not ended.
const NOON = new Date("2026-01-15T11:00:00.000Z");
const NEXT_NOON = new Date("2026-01-16T11:00:00.000Z");
const TODAY = "2026-01-15";
const TOMORROW = "2026-01-16";

function setup(owner = true) {
  let p = 0;
  let e = 0;
  const clock = { now: NOON };
  const products = new InMemoryProductStore(() => `p-${++p}`);
  const plans = new InMemoryPlanStore(() => `e-${++e}`);
  const targets = new InMemoryTargetStore();
  const app = buildApp({
    store: products,
    dishStore: new InMemoryDishStore(() => "d-1"),
    planStore: plans,
    targetStore: targets,
    isOwner: owner ? () => true : undefined,
    clock: () => clock.now,
    timeZone: ZONE,
  });
  return { app, products, plans, targets, clock };
}

type Ctx = ReturnType<typeof setup>;
const item = (name: string): NewProduct => ({ name, shop: "Shop A", calories: 100, protein: 1, fat: 1, source: "manual" });
const range = (ctx: Ctx, nutrient: TargetNutrient, minimum: number, maximum: number, from: string) =>
  ctx.targets.save({ nutrient, minimum, maximum, effective_from: from });
const close = (ctx: Ctx, date: string) => ctx.app.inject({ method: "POST", url: `/days/${date}/close` });
const openDays = (ctx: Ctx, before: string) => ctx.app.inject({ method: "GET", url: `/days/open?before=${before}` });
const logAdd = (ctx: Ctx, date: string, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: "POST", url: `/days/${date}/log/entries`, payload });
const planAdd = (ctx: Ctx, date: string, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: "POST", url: `/days/${date}/plan/entries`, payload });
const logGet = (ctx: Ctx, date: string) => ctx.app.inject({ method: "GET", url: `/days/${date}/log` });
const planGet = (ctx: Ctx, date: string) => ctx.app.inject({ method: "GET", url: `/days/${date}/plan` });
/** A setup whose first day of use is 2026-01-10 and that has one 100 g rice log entry on the given day. */
async function withRice(date: string) {
  const ctx = setup();
  await range(ctx, "calories", 1800, 2200, "2026-01-10");
  const rice = await ctx.products.add(item("Rice"));
  const added = await logAdd(ctx, date, { meal: "lunch", product_id: rice.id, grams: 100 });
  return { ctx, rice, entry: added.json() as { id: string } };
}

describe("closeDay", () => {
  // cites: REQ-011/AC-001, REQ-011/AC-008
  it("closes today with log entries before the day ends, with closed_at from the clock", async () => {
    const { ctx } = await withRice(TODAY);
    const res = await close(ctx, TODAY);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: "log", date: TODAY, closed: true, closed_at: NOON.toISOString(), editable: false });
    expect((await ctx.plans.read(TODAY, "log")).entries).toHaveLength(1);
  });

  // cites: REQ-011/AC-001
  it("stores one row for each nutrient that has a range and none for a nutrient without one", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, "2026-01-10");
    await range(ctx, "protein", 90, 120, "2026-01-10");
    await close(ctx, TODAY);
    expect(await ctx.plans.closedRanges(TODAY)).toEqual([
      { nutrient: "calories", minimum: 1800, maximum: 2200 },
      { nutrient: "protein", minimum: 90, maximum: 120 },
    ]);
  });

  // cites: REQ-011/AC-001
  it("stores the ranges in force on the closed date, not a later range", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, "2026-01-10");
    await range(ctx, "calories", 2000, 2500, "2026-01-14");
    await close(ctx, "2026-01-12");
    expect(await ctx.plans.closedRanges("2026-01-12")).toEqual([{ nutrient: "calories", minimum: 1800, maximum: 2200 }]);
  });

  // cites: REQ-011/AC-010
  it("closes a past day that has no entries", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, "2026-01-10");
    const res = await close(ctx, "2026-01-12");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ date: "2026-01-12", closed: true, closed_at: NOON.toISOString() });
    expect(await ctx.plans.closedRanges("2026-01-12")).toHaveLength(1);
  });

  // cites: IF-001@1.6.0#closeDay
  it("refuses a date after today and a date before the first day of use with close.day_out_of_range", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, "2026-01-10");
    const after = await close(ctx, TOMORROW);
    const before = await close(ctx, "2026-01-09");
    expect(after.statusCode).toBe(422);
    expect(after.json().code).toBe("close.day_out_of_range");
    expect(before.statusCode).toBe(422);
    expect(before.json().code).toBe("close.day_out_of_range");
    expect((await ctx.plans.read(TOMORROW)).closed).toBe(false);
    expect(await ctx.plans.firstRecordedDay()).toBeUndefined();
  });

  // cites: REQ-016/AC-002
  it("refuses a second close with day.closed and keeps closed_at and the stored ranges", async () => {
    const { ctx } = await withRice(TODAY);
    await close(ctx, TODAY);
    ctx.clock.now = new Date("2026-01-15T15:00:00.000Z");
    const again = await close(ctx, TODAY);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("day.closed");
    expect(await ctx.plans.closedAt(TODAY)).toEqual(NOON);
    expect(await ctx.plans.closedRanges(TODAY)).toHaveLength(1);
  });

  // cites: REQ-016/AC-006
  it("closes day D and leaves day D-1 open", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, "2026-01-10");
    await close(ctx, TODAY);
    expect((await logGet(ctx, "2026-01-14")).json()).toMatchObject({ closed: false, closed_at: null });
    expect((await logGet(ctx, TODAY)).json().closed).toBe(true);
    expect((await openDays(ctx, TOMORROW)).json().days).toContain("2026-01-14");
  });

  // cites: IF-001@1.6.0#closeDay
  it("refuses a request without an Owner session and a date that is not a calendar date", async () => {
    const noOwner = setup(false);
    expect((await close(noOwner, TODAY)).statusCode).toBe(401);
    expect((await openDays(noOwner, TODAY)).statusCode).toBe(401);
    const ctx = setup();
    expect((await close(ctx, "2026-02-30")).statusCode).toBe(400);
    expect((await openDays(ctx, "not-a-date")).statusCode).toBe(400);
  });
});

describe("writes on a closed day", () => {
  // cites: REQ-014/AC-011
  it("does not save a log entry added to a day closed through closeDay", async () => {
    const { ctx, rice } = await withRice(TODAY);
    await close(ctx, TODAY);
    const res = await logAdd(ctx, TODAY, { meal: "dinner", product_id: rice.id, grams: 50 });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("day.closed");
    expect((await ctx.plans.read(TODAY, "log")).entries).toHaveLength(1);
  });

  // cites: REQ-013/AC-007
  it("does not change the plan of a day closed through closeDay", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, "2026-01-10");
    const rice = await ctx.products.add(item("Rice"));
    const added = (await planAdd(ctx, TODAY, { meal: "lunch", product_id: rice.id, grams: 100 })).json();
    await close(ctx, TODAY);
    const add = await planAdd(ctx, TODAY, { meal: "dinner", product_id: rice.id, grams: 50 });
    const change = await ctx.app.inject({ method: "PATCH", url: `/days/${TODAY}/plan/entries/${added.id}`, payload: { grams: 80 } });
    expect(add.statusCode).toBe(409);
    expect(change.statusCode).toBe(409);
    const plan = await ctx.plans.read(TODAY);
    expect(plan.entries.map((x) => x.grams)).toEqual([100]);
  });

  // cites: REQ-011/AC-003, REQ-016/AC-002
  it("does not apply a change or a removal of a log entry of a closed day", async () => {
    const { ctx, entry } = await withRice(TODAY);
    await close(ctx, TODAY);
    const change = await ctx.app.inject({ method: "PATCH", url: `/days/${TODAY}/log/entries/${entry.id}`, payload: { grams: 80 } });
    const remove = await ctx.app.inject({ method: "DELETE", url: `/days/${TODAY}/log/entries/${entry.id}` });
    expect(change.statusCode).toBe(409);
    expect(remove.statusCode).toBe(409);
    expect((await ctx.plans.read(TODAY, "log")).entries.map((x) => x.grams)).toEqual([100]);
  });

  // cites: REQ-011/AC-007
  it("applies an add, a change and a removal on an open past day", async () => {
    const { ctx, rice } = await withRice("2026-01-12");
    const added = await logAdd(ctx, "2026-01-12", { meal: "dinner", product_id: rice.id, grams: 50 });
    const id = (added.json() as { id: string }).id;
    expect(added.statusCode).toBe(201);
    const change = await ctx.app.inject({ method: "PATCH", url: `/days/2026-01-12/log/entries/${id}`, payload: { grams: 60 } });
    expect(change.statusCode).toBe(200);
    const remove = await ctx.app.inject({ method: "DELETE", url: `/days/2026-01-12/log/entries/${id}` });
    expect(remove.statusCode).toBe(204);
    expect((await ctx.plans.read("2026-01-12", "log")).entries.map((x) => x.grams)).toEqual([100]);
  });
});

describe("closed_at on the day sheets", () => {
  // cites: IF-001@1.6.0#getDayPlan
  it("is null on an open day and the close time on a closed day, for the plan and the log", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, "2026-01-10");
    expect((await planGet(ctx, TODAY)).json()).toMatchObject({ closed: false, closed_at: null });
    expect((await logGet(ctx, TODAY)).json()).toMatchObject({ closed: false, closed_at: null });
    await close(ctx, TODAY);
    expect((await planGet(ctx, TODAY)).json()).toMatchObject({ closed: true, closed_at: NOON.toISOString(), editable: false });
    expect((await logGet(ctx, TODAY)).json()).toMatchObject({ closed: true, closed_at: NOON.toISOString(), editable: false });
  });

  // cites: REQ-011/AC-002
  it("keeps an unconfirmed day open when the date has moved to the next day", async () => {
    const { ctx } = await withRice(TODAY);
    ctx.clock.now = NEXT_NOON;
    expect((await logGet(ctx, TODAY)).json()).toMatchObject({ today: TOMORROW, closed: false, closed_at: null });
  });

  // cites: REQ-016/AC-003
  it("does not close a day that had a plan and nothing logged when it has passed", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, "2026-01-10");
    const rice = await ctx.products.add(item("Rice"));
    await planAdd(ctx, TODAY, { meal: "lunch", product_id: rice.id, grams: 100 });
    ctx.clock.now = new Date("2026-01-17T11:00:00.000Z");
    expect((await logGet(ctx, TODAY)).json()).toMatchObject({ closed: false, closed_at: null });
    expect((await openDays(ctx, "2026-01-17")).json().days).toContain(TODAY);
  });
});

describe("getOpenDays", () => {
  // cites: REQ-011/AC-004
  it("lists the open days before the day to plan, oldest first, so day D is reminded", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, "2026-01-13");
    const res = await openDays(ctx, TOMORROW);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ first_day_of_use: "2026-01-13", before: TOMORROW, days: ["2026-01-13", "2026-01-14", TODAY] });
  });

  // cites: REQ-011/AC-006
  it("lists no open day when every day before the day to plan is closed, and planning is allowed", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, "2026-01-13");
    for (const date of ["2026-01-13", "2026-01-14", TODAY]) await close(ctx, date);
    expect((await openDays(ctx, TOMORROW)).json().days).toEqual([]);
    const rice = await ctx.products.add(item("Rice"));
    expect((await planAdd(ctx, TOMORROW, { meal: "lunch", product_id: rice.id, grams: 100 })).statusCode).toBe(201);
  });

  // cites: REQ-011/AC-012
  it("reminds about an open today and still allows planning the next day", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, TODAY);
    expect((await openDays(ctx, TOMORROW)).json().days).toEqual([TODAY]);
    const rice = await ctx.products.add(item("Rice"));
    expect((await planAdd(ctx, TOMORROW, { meal: "lunch", product_id: rice.id, grams: 100 })).statusCode).toBe(201);
  });

  // cites: REQ-011/AC-013
  it("reminds about D-2 when D-1 is closed, and still allows planning day D", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, "2026-01-13");
    await close(ctx, "2026-01-14");
    expect((await openDays(ctx, TODAY)).json().days).toEqual(["2026-01-13"]);
    const rice = await ctx.products.add(item("Rice"));
    expect((await planAdd(ctx, TODAY, { meal: "lunch", product_id: rice.id, grams: 100 })).statusCode).toBe(201);
  });

  // cites: REQ-011/AC-011
  it("lists no date before the first day of use, and planning the first day is allowed", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, TODAY);
    const res = await openDays(ctx, TODAY);
    expect(res.json()).toEqual({ first_day_of_use: TODAY, before: TODAY, days: [] });
    const rice = await ctx.products.add(item("Rice"));
    expect((await planAdd(ctx, TODAY, { meal: "lunch", product_id: rice.id, grams: 100 })).statusCode).toBe(201);
  });
});

describe("firstDayOfUse", () => {
  const at = new Date("2026-01-05T08:00:00.000Z");

  // cites: REQ-011/AC-011
  it("is the earliest of the saved ranges and the day records", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, "2026-01-10");
    await ctx.plans.mutate("2026-01-05", at, async () => undefined);
    expect(await firstDayOfUse(ctx.targets, ctx.plans, TODAY)).toBe("2026-01-05");
  });

  // cites: REQ-011/AC-011
  it("is never later than today", async () => {
    const ctx = setup();
    await range(ctx, "calories", 1800, 2200, "2026-02-01");
    expect(await firstDayOfUse(ctx.targets, ctx.plans, TODAY)).toBe(TODAY);
  });

  // cites: REQ-011/AC-011
  it("is today when nothing is recorded", async () => {
    const ctx = setup();
    expect(await firstDayOfUse(ctx.targets, ctx.plans, TODAY)).toBe(TODAY);
  });
});
