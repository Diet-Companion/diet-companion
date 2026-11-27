import { describe, expect, it } from "vitest";
import type { FetchLike } from "./api";
import { createLogApi } from "./logApi";
import { createPlanApi } from "./planApi";

function fakeFetch(body: unknown): FetchLike {
  return async () => new Response(JSON.stringify(body), { status: 200 });
}

function nutrient(n: string, unit: string, total: number, min: number | null, max: number | null, status: string, num: string | null) {
  return { nutrient: n, unit, total, minimum: min, maximum: max, status, signed_number: num };
}

function result(total: number, status: string, num: string) {
  return {
    ranges_source: "in_force",
    nutrients: [
      nutrient("calories", "kcal", total, 1800, 2200, status, num),
      nutrient("protein", "g", 90, null, null, "no_range", null),
      nutrient("fat", "g", 60, 50, 70, "green", "-10"),
    ],
  };
}

const TOTALS = { calories: 600, protein: 30, fat: 20 };

function meals() {
  return [
    { meal: "breakfast", has_plan: false, entries: [], totals: TOTALS },
    { meal: "lunch", has_plan: false, entries: [], totals: { calories: 0, protein: 0, fat: 0 } },
  ];
}

function body(res: unknown, date: string) {
  return { kind: "x", date, today: "2026-01-05", closed: false, editable: true, meals: meals(), result: res };
}

// The calories entry the plan or the log api reads from a response with this result.
async function planCalories(total: number, status: string, num: string) {
  const api = createPlanApi(fakeFetch(body(result(total, status, num), "2026-01-06")), () => "run-1");
  const r = await api.getDayPlan("2026-01-06");
  if (r.kind !== "ok") throw new Error("expected ok");
  const n = r.sheet.result?.nutrients[0];
  return [n?.total, n?.status, n?.signed_number];
}

async function logCalories(total: number, status: string, num: string) {
  const api = createLogApi(fakeFetch(body(result(total, status, num), "2026-01-05")), () => "run-1");
  const r = await api.getDayLog("2026-01-05");
  if (r.kind !== "ok") throw new Error("expected ok");
  const n = r.day.result?.nutrients[0];
  return [n?.total, n?.status, n?.signed_number];
}

describe("day result parsing", () => {
  // cites: REQ-010/AC-017
  it("keeps 1500 yellow -300 as the server sent it, on both screens", async () => {
    expect(await planCalories(1500, "yellow", "-300")).toEqual([1500, "yellow", "-300"]);
    expect(await logCalories(1500, "yellow", "-300")).toEqual([1500, "yellow", "-300"]);
  });

  // cites: REQ-010/AC-018
  it("keeps 2500 red +300 as the server sent it, on both screens", async () => {
    expect(await planCalories(2500, "red", "+300")).toEqual([2500, "red", "+300"]);
    expect(await logCalories(2500, "red", "+300")).toEqual([2500, "red", "+300"]);
  });

  // cites: REQ-010/AC-019
  it("keeps 2000 green -200 as the server sent it, on both screens", async () => {
    expect(await planCalories(2000, "green", "-200")).toEqual([2000, "green", "-200"]);
    expect(await logCalories(2000, "green", "-200")).toEqual([2000, "green", "-200"]);
  });

  // cites: REQ-010/AC-020
  it("keeps 1800 green -400 as the server sent it", async () => {
    expect(await logCalories(1800, "green", "-400")).toEqual([1800, "green", "-400"]);
  });

  // cites: REQ-010/AC-021
  it("keeps 2200 green 0 as the server sent it, as the string 0", async () => {
    expect(await logCalories(2200, "green", "0")).toEqual([2200, "green", "0"]);
  });

  // cites: REQ-010/AC-022
  it("keeps 2190 green -10 as the server sent it", async () => {
    expect(await logCalories(2190, "green", "-10")).toEqual([2190, "green", "-10"]);
  });

  // cites: REQ-010/AC-023
  it("keeps a plan day over the maximum as red +300", async () => {
    expect(await planCalories(2500, "red", "+300")).toEqual([2500, "red", "+300"]);
  });

  // cites: REQ-010/AC-024
  it("keeps a partly logged day 400 yellow -1400 as sent", async () => {
    expect(await logCalories(400, "yellow", "-1400")).toEqual([400, "yellow", "-1400"]);
  });

  // cites: REQ-010/AC-025
  it("keeps the total 1800 sent for an unrounded 1799.6, green -400", async () => {
    expect(await logCalories(1800, "green", "-400")).toEqual([1800, "green", "-400"]);
  });

  // cites: REQ-010/AC-026
  it("keeps 1799 yellow -1 as the server sent it", async () => {
    expect(await logCalories(1799, "yellow", "-1")).toEqual([1799, "yellow", "-1"]);
  });

  // cites: REQ-010/AC-027
  it("keeps 2201 red +1 as the server sent it", async () => {
    expect(await logCalories(2201, "red", "+1")).toEqual([2201, "red", "+1"]);
  });

  // cites: REQ-010/AC-028
  it("keeps 2199 green -1 as the server sent it", async () => {
    expect(await logCalories(2199, "green", "-1")).toEqual([2199, "green", "-1"]);
  });

  // cites: REQ-010/AC-012
  it("keeps a whole total the server rounded as it is", async () => {
    expect((await logCalories(100, "yellow", "-1700"))[0]).toBe(100);
  });

  // cites: REQ-010/AC-007
  it("reads the log sheet result 1300, with no plan added", async () => {
    expect(await logCalories(1300, "yellow", "-500")).toEqual([1300, "yellow", "-500"]);
  });

  // cites: REQ-010/AC-010
  it("reads the result of a closed day, with the closed-copy source and the server's order", async () => {
    const closed = { ...body({ ...result(1300, "green", "-900"), ranges_source: "closed_copy" }, "2026-01-05"), closed: true, editable: false };
    const r = await createLogApi(fakeFetch(closed), () => "run-1").getDayLog("2026-01-05");
    expect(r.kind === "ok" && r.day.result?.ranges_source).toBe("closed_copy");
    expect(r.kind === "ok" && r.day.result?.nutrients.map((n) => n.nutrient)).toEqual(["calories", "protein", "fat"]);
  });

  // cites: REQ-010/AC-013
  it("reads the totals of each meal as whole numbers, on both screens", async () => {
    const plan = await createPlanApi(fakeFetch(body(result(0, "yellow", "-1800"), "2026-01-06")), () => "run-1").getDayPlan("2026-01-06");
    expect(plan.kind === "ok" && plan.sheet.meals[0]?.totals).toEqual(TOTALS);
    const log = await createLogApi(fakeFetch(body(result(0, "yellow", "-1800"), "2026-01-05")), () => "run-1").getDayLog("2026-01-05");
    expect(log.kind === "ok" && log.day.meals[0]?.totals).toEqual(TOTALS);
  });

  // cites: REQ-015/AC-010
  it("reads only the three totals of a meal, and a null number for no_range", async () => {
    const api = createLogApi(fakeFetch(body(result(1500, "yellow", "-300"), "2026-01-05")), () => "run-1");
    const r = await api.getDayLog("2026-01-05");
    expect(r.kind === "ok" && Object.keys(r.day.meals[0]?.totals ?? {})).toEqual(["calories", "protein", "fat"]);
    expect(r.kind === "ok" && r.day.result?.nutrients[1]?.signed_number).toBeNull();
  });

  // cites: REQ-015/AC-011
  it("fails the day when the result is malformed and does not invent one", async () => {
    const bad = body({ ranges_source: "in_force", nutrients: [{ nutrient: "x" }] }, "2026-01-05");
    const r = await createLogApi(fakeFetch(bad), () => "run-1").getDayLog("2026-01-05");
    expect(r.kind).toBe("failed");
  });
});
