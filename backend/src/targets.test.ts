import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryTargetStore } from "./target-store.js";

const TODAY = new Date("2026-01-15T10:00:00.000Z");

function setup(owner = true, now: Date = TODAY, timeZone = "Europe/Rome") {
  const targets = new InMemoryTargetStore();
  const app = buildApp({ targetStore: targets, isOwner: owner ? () => true : undefined, clock: () => now, timeZone });
  return { app, targets };
}

const calories = (minimum: number, maximum: number, effective_from: string) => ({
  nutrient: "calories" as const,
  minimum,
  maximum,
  effective_from,
});

describe("target range reads", () => {
  // cites: IF-001@1.4.0#getTargetRanges
  it("refuses every read without an Owner session", async () => {
    const { app } = setup(false);
    const today = await app.inject({ method: "GET", url: "/target-ranges" });
    const on = await app.inject({ method: "GET", url: "/target-ranges/on/2026-01-15" });
    expect(today.statusCode).toBe(401);
    expect(today.json().code).toBe("auth.required");
    expect(on.statusCode).toBe(401);
  });

  // cites: REQ-009/AC-001, IF-001@1.4.0#getTargetRanges
  it("reports no ranges and setup not complete when nothing was saved", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/target-ranges" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ as_of: "2026-01-15", setup_complete: false, calories: null, protein: null, fat: null });
  });

  // cites: REQ-009/AC-001, IF-001@1.4.0#getTargetRanges
  it("is set up only when calories, protein and fat each have a range", async () => {
    const { app, targets } = setup();
    await targets.save(calories(1800, 2200, "2026-01-15"));
    await targets.save({ nutrient: "protein", minimum: 80, maximum: 120, effective_from: "2026-01-15" });
    expect((await app.inject({ method: "GET", url: "/target-ranges" })).json().setup_complete).toBe(false);
    await targets.save({ nutrient: "fat", minimum: 50, maximum: 70, effective_from: "2026-01-15" });
    const body = (await app.inject({ method: "GET", url: "/target-ranges" })).json();
    expect(body.setup_complete).toBe(true);
    expect(body.fat).toEqual({ nutrient: "fat", minimum: 50, maximum: 70, unit: "g", effective_from: "2026-01-15" });
    expect(body.calories.unit).toBe("kcal");
  });

  // cites: REQ-009/AC-005, REQ-009/AC-006, ADR-015/C-003
  it("keeps the old range before day D and gives the new one from D on", async () => {
    const { app, targets } = setup();
    await targets.save(calories(1800, 2200, "2026-01-10"));
    await targets.save(calories(1900, 2300, "2026-01-15"));
    const on = async (date: string) =>
      (await app.inject({ method: "GET", url: `/target-ranges/on/${date}` })).json().calories;
    expect(await on("2026-01-14")).toMatchObject({ minimum: 1800, maximum: 2200, effective_from: "2026-01-10" });
    expect(await on("2026-01-15")).toMatchObject({ minimum: 1900, maximum: 2300, effective_from: "2026-01-15" });
    expect(await on("2026-01-20")).toMatchObject({ minimum: 1900, maximum: 2300 });
    expect(await on("2026-01-09")).toBeNull();
  });

  // cites: REQ-009/AC-005, A-033
  it("lets a second save on day D overwrite D's range", async () => {
    const { app, targets } = setup();
    await targets.save(calories(1800, 2200, "2026-01-15"));
    await targets.save(calories(1900, 2300, "2026-01-15"));
    const body = (await app.inject({ method: "GET", url: "/target-ranges" })).json();
    expect(body.calories).toMatchObject({ minimum: 1900, maximum: 2300 });
  });

  // cites: REQ-009/AC-006, IF-001@1.4.0#getTargetRangesOn
  it("has no range for a nutrient that was never set", async () => {
    const { app, targets } = setup();
    await targets.save(calories(1800, 2200, "2026-01-15"));
    const body = (await app.inject({ method: "GET", url: "/target-ranges/on/2026-01-15" })).json();
    expect(body.protein).toBeNull();
    expect(body.as_of).toBe("2026-01-15");
  });

  // cites: IF-001@1.4.0#getTargetRangesOn
  it("refuses a date that is not a valid calendar date", async () => {
    const { app } = setup();
    for (const date of ["2026-02-30", "yesterday", "2026-1-5"]) {
      const res = await app.inject({ method: "GET", url: `/target-ranges/on/${date}` });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("request.invalid");
    }
  });

  // cites: ADR-016/C-001, IF-001@1.4.0#getTargetRanges
  it("takes today from the clock and zone, not from the request", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/target-ranges?date=2030-05-05" });
    expect(res.json().as_of).toBe("2026-01-15");
  });

  // cites: ADR-016/C-001, REQ-009/AC-005
  it("changes as_of at local midnight in Europe/Rome, in winter and in summer", async () => {
    const asOf = async (iso: string) =>
      (await setup(true, new Date(iso)).app.inject({ method: "GET", url: "/target-ranges" })).json().as_of;
    expect(await asOf("2026-01-15T22:59:59.000Z")).toBe("2026-01-15");
    expect(await asOf("2026-01-15T23:00:00.000Z")).toBe("2026-01-16");
    expect(await asOf("2026-07-15T21:59:59.000Z")).toBe("2026-07-15");
    expect(await asOf("2026-07-15T22:00:00.000Z")).toBe("2026-07-16");
  });
});
