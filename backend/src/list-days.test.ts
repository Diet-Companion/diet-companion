import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryDishStore } from "./in-memory-dish-store.js";
import { InMemoryPlanStore } from "./in-memory-plan-store.js";
import { InMemoryProductStore } from "./products.js";
import { InMemoryTargetStore } from "./target-store.js";

const ZONE = "Europe/Rome";
// Noon in Rome on 2026-01-15: today is 2026-01-15.
const NOON = new Date("2026-01-15T11:00:00.000Z");
const TODAY = "2026-01-15";
const TOMORROW = "2026-01-16";

interface Item {
  date: string;
  state: string;
  open_past: boolean;
  closed_at: string | null;
}
interface Page {
  first_day_of_use: string | null;
  items: Item[];
  next_before: string | null;
}

function setup(owner = true) {
  let p = 0;
  let e = 0;
  const products = new InMemoryProductStore(() => `p-${++p}`);
  const plans = new InMemoryPlanStore(() => `e-${++e}`);
  const targets = new InMemoryTargetStore();
  const app = buildApp({
    store: products,
    dishStore: new InMemoryDishStore(() => "d-1"),
    planStore: plans,
    targetStore: targets,
    isOwner: owner ? () => true : undefined,
    clock: () => NOON,
    timeZone: ZONE,
  });
  return { app, products, plans, targets };
}

type Ctx = ReturnType<typeof setup>;
const firstUse = (ctx: Ctx, from: string) =>
  ctx.targets.save({ nutrient: "calories", minimum: 1800, maximum: 2200, effective_from: from });
const list = (ctx: Ctx, query = "") => ctx.app.inject({ method: "GET", url: `/days${query}` });
const page = async (ctx: Ctx, query = "") => (await list(ctx, query)).json() as Page;
const close = (ctx: Ctx, date: string) => ctx.app.inject({ method: "POST", url: `/days/${date}/close` });

describe("listDays", () => {
  // cites: REQ-016/AC-001
  it("REQ-016/AC-001 reads and lists a day 400 days back", async () => {
    const ctx = setup();
    const old = "2024-12-11";
    await firstUse(ctx, old);
    const rice = await ctx.products.add({ name: "Rice", shop: "Shop A", calories: 100, protein: 1, fat: 1, source: "manual" });
    const added = await ctx.app.inject({
      method: "POST",
      url: `/days/${old}/log/entries`,
      payload: { meal: "lunch", product_id: rice.id, grams: 100 },
    });
    expect(added.statusCode).toBe(201);
    const log = await ctx.app.inject({ method: "GET", url: `/days/${old}/log` });
    expect(log.statusCode).toBe(200);
    expect(log.json()).toMatchObject({ date: old, closed: false });
    const plan = await ctx.app.inject({ method: "GET", url: `/days/${old}/plan` });
    expect(plan.statusCode).toBe(200);
    const result = await page(ctx, "?before=2024-12-12");
    expect(result).toEqual({
      first_day_of_use: old,
      items: [{ date: old, state: "open", open_past: true, closed_at: null }],
      next_before: null,
    });
  });

  // cites: REQ-016/AC-001
  it("REQ-016/AC-001 lists newest first from today by default, empty days included", async () => {
    const ctx = setup();
    await firstUse(ctx, "2026-01-13");
    const result = await page(ctx);
    expect(result.first_day_of_use).toBe("2026-01-13");
    expect(result.items.map((i) => i.date)).toEqual([TODAY, "2026-01-14", "2026-01-13"]);
    expect(result.next_before).toBeNull();
  });

  // cites: REQ-016/AC-001
  it("REQ-016/AC-001 starts the page at the day before the before date", async () => {
    const ctx = setup();
    await firstUse(ctx, "2026-01-10");
    const result = await page(ctx, "?before=2026-01-14");
    expect(result.items.map((i) => i.date)).toEqual(["2026-01-13", "2026-01-12", "2026-01-11", "2026-01-10"]);
  });

  // cites: REQ-016/AC-001
  it("REQ-016/AC-001 takes the first day of use as today when nothing is recorded", async () => {
    const ctx = setup();
    expect(await page(ctx)).toEqual({
      first_day_of_use: TODAY,
      items: [{ date: TODAY, state: "open", open_past: false, closed_at: null }],
      next_before: null,
    });
  });

  // cites: REQ-016/AC-001
  it("REQ-016/AC-001 returns an empty page when before is not after the first day of use", async () => {
    const ctx = setup();
    await firstUse(ctx, "2026-01-10");
    expect(await page(ctx, "?before=2026-01-10")).toEqual({ first_day_of_use: "2026-01-10", items: [], next_before: null });
  });

  // cites: REQ-016/AC-004
  it("REQ-016/AC-004 marks a past open day open_past and today not", async () => {
    const ctx = setup();
    await firstUse(ctx, "2026-01-13");
    const result = await page(ctx);
    expect(result.items).toEqual([
      { date: TODAY, state: "open", open_past: false, closed_at: null },
      { date: "2026-01-14", state: "open", open_past: true, closed_at: null },
      { date: "2026-01-13", state: "open", open_past: true, closed_at: null },
    ]);
  });

  // cites: REQ-016/AC-005
  it("REQ-016/AC-005 shows a closed day as closed, not open_past, with its closed_at", async () => {
    const ctx = setup();
    await firstUse(ctx, "2026-01-13");
    await close(ctx, "2026-01-14");
    const result = await page(ctx);
    expect(result.items).toEqual([
      { date: TODAY, state: "open", open_past: false, closed_at: null },
      { date: "2026-01-14", state: "closed", open_past: false, closed_at: NOON.toISOString() },
      { date: "2026-01-13", state: "open", open_past: true, closed_at: null },
    ]);
  });

  // cites: REQ-016/AC-001
  it("REQ-016/AC-001 pages with next_before and ends exactly at the first day of use", async () => {
    const ctx = setup();
    await firstUse(ctx, "2026-01-10");
    const one = await page(ctx, "?limit=3");
    expect(one.items.map((i) => i.date)).toEqual([TODAY, "2026-01-14", "2026-01-13"]);
    expect(one.next_before).toBe("2026-01-13");
    const two = await page(ctx, `?limit=3&before=${one.next_before}`);
    expect(two.items.map((i) => i.date)).toEqual(["2026-01-12", "2026-01-11", "2026-01-10"]);
    expect(two.next_before).toBeNull();
  });

  // cites: REQ-016/AC-001
  it("REQ-016/AC-001 with limit 1 gives one day and the next before value", async () => {
    const ctx = setup();
    await firstUse(ctx, "2026-01-10");
    const result = await page(ctx, "?limit=1");
    expect(result.items.map((i) => i.date)).toEqual([TODAY]);
    expect(result.next_before).toBe(TODAY);
  });

  // cites: REQ-016/AC-001
  it("REQ-016/AC-001 with limit 100 gives 100 days and a next page, and defaults to 31", async () => {
    const ctx = setup();
    await firstUse(ctx, "2025-10-01");
    const full = await page(ctx, "?limit=100");
    expect(full.items).toHaveLength(100);
    expect(full.items[0]?.date).toBe(TODAY);
    expect(full.items[99]?.date).toBe("2025-10-08");
    expect(full.next_before).toBe("2025-10-08");
    const byDefault = await page(ctx);
    expect(byDefault.items).toHaveLength(31);
  });

  // cites: REQ-016/AC-001
  it("REQ-016/AC-001 accepts a before date of tomorrow", async () => {
    const ctx = setup();
    await firstUse(ctx, "2026-01-14");
    const result = await page(ctx, `?before=${TOMORROW}`);
    expect(result.items.map((i) => i.date)).toEqual([TODAY, "2026-01-14"]);
  });

  // cites: IF-001@1.6.0#listDays
  it("refuses a before after tomorrow, a bad date and a bad limit with 400 request.invalid", async () => {
    const ctx = setup();
    for (const query of ["?before=2026-01-17", "?before=2026-02-30", "?before=abc", "?limit=0", "?limit=101", "?limit=abc", "?limit=1.5", "?limit=-1"]) {
      const res = await list(ctx, query);
      expect(res.statusCode, query).toBe(400);
      expect(res.json().code).toBe("request.invalid");
    }
  });

  // cites: IF-001@1.6.0#listDays
  it("refuses a request without an Owner session", async () => {
    const ctx = setup(false);
    expect((await list(ctx)).statusCode).toBe(401);
  });
});
