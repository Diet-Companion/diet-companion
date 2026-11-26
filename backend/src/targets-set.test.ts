import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryTargetStore, type StoredRange } from "./target-store.js";

const TODAY = new Date("2026-01-15T10:00:00.000Z");
const NEXT_DAY = new Date("2026-01-16T10:00:00.000Z");

function setup(owner = true, now: () => Date = () => TODAY) {
  const targets = new InMemoryTargetStore();
  const saves: StoredRange[] = [];
  const original = targets.save.bind(targets);
  targets.save = async (range) => {
    saves.push(range);
    return original(range);
  };
  const app = buildApp({ targetStore: targets, isOwner: owner ? () => true : undefined, clock: now, timeZone: "Europe/Rome" });
  return { app, targets, saves };
}

const put = (app: ReturnType<typeof setup>["app"], nutrient: string, payload: unknown) =>
  app.inject({ method: "PUT", url: `/target-ranges/${nutrient}`, payload: payload as object });

describe("setTargetRange", () => {
  // cites: IF-001@1.4.0#setTargetRange
  it("refuses a save without an Owner session", async () => {
    const { app, saves } = setup(false);
    const res = await put(app, "calories", { minimum: 1800, maximum: 2200 });
    expect(res.statusCode).toBe(401);
    expect(saves).toEqual([]);
  });

  // cites: REQ-009/AC-002, R-011
  it("refuses a minimum above the maximum with target.range_inverted and keeps the previous range", async () => {
    const { app, targets, saves } = setup();
    await targets.save({ nutrient: "calories", minimum: 1800, maximum: 2200, effective_from: "2026-01-10" });
    saves.length = 0;
    const res = await put(app, "calories", { minimum: 2000, maximum: 1800 });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("target.range_inverted");
    expect(res.json().invalid).toEqual(["minimum", "maximum"]);
    expect(saves).toEqual([]);
    expect(await targets.rangeInForce("calories", "2026-01-15")).toMatchObject({ minimum: 1800, maximum: 2200 });
  });

  // cites: REQ-009/AC-003, R-011
  it("refuses a missing maximum with target.values_missing", async () => {
    const { app, saves } = setup();
    const res = await put(app, "protein", { minimum: 80 });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("target.values_missing");
    expect(res.json().missing).toEqual(["maximum"]);
    expect(saves).toEqual([]);
  });

  // cites: REQ-009/AC-003, R-011
  it("refuses a missing minimum with target.values_missing", async () => {
    const { app, saves } = setup();
    const res = await put(app, "protein", { maximum: 120 });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("target.values_missing");
    expect(res.json().missing).toEqual(["minimum"]);
    expect(saves).toEqual([]);
  });

  // cites: REQ-009/AC-003, R-011
  it("treats a null limit as missing", async () => {
    const { app, saves } = setup();
    const res = await put(app, "protein", { minimum: null, maximum: 120 });
    expect(res.statusCode).toBe(422);
    expect(res.json().missing).toEqual(["minimum"]);
    expect(saves).toEqual([]);
  });

  // cites: REQ-009/AC-004, R-011
  it("saves a range whose minimum equals its maximum", async () => {
    const { app } = setup();
    const res = await put(app, "fat", { minimum: 70, maximum: 70 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ nutrient: "fat", minimum: 70, maximum: 70, unit: "g", effective_from: "2026-01-15" });
  });

  // cites: REQ-009/AC-009, R-011
  it("saves a range with 0 as the minimum", async () => {
    const { app } = setup();
    const res = await put(app, "calories", { minimum: 0, maximum: 2200 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ minimum: 0, maximum: 2200, unit: "kcal" });
  });

  // cites: REQ-009/AC-010, R-011
  it("refuses a negative limit with target.value_invalid and keeps the previous range", async () => {
    const { app, targets, saves } = setup();
    await targets.save({ nutrient: "calories", minimum: 1800, maximum: 2200, effective_from: "2026-01-10" });
    saves.length = 0;
    const res = await put(app, "calories", { minimum: -1, maximum: 2200 });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("target.value_invalid");
    expect(res.json().invalid).toEqual(["minimum"]);
    expect(saves).toEqual([]);
    expect(await targets.rangeInForce("calories", "2026-01-15")).toMatchObject({ minimum: 1800, maximum: 2200 });
  });

  // cites: REQ-009/AC-010, R-011
  it("refuses a decimal limit with target.value_invalid", async () => {
    const { app, saves } = setup();
    const res = await put(app, "calories", { minimum: 1800, maximum: 2200.5 });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("target.value_invalid");
    expect(res.json().invalid).toEqual(["maximum"]);
    expect(saves).toEqual([]);
  });

  // cites: A-030, R-011, IF-001@1.4.0#setTargetRange
  it("refuses a limit above 2147483647 with target.value_invalid", async () => {
    const { app, saves } = setup();
    const res = await put(app, "calories", { minimum: 1800, maximum: 2147483648 });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("target.value_invalid");
    expect(saves).toEqual([]);
    const top = await put(app, "calories", { minimum: 1800, maximum: 2147483647 });
    expect(top.statusCode).toBe(200);
  });

  // cites: REQ-009/AC-008
  it("answers target.nutrient_unknown for any nutrient but calories, protein and fat", async () => {
    const { app, saves } = setup();
    const res = await put(app, "salt", { minimum: 1, maximum: 2 });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("target.nutrient_unknown");
    expect(saves).toEqual([]);
  });

  // cites: REQ-009/AC-007, ADR-016/C-001
  it("ignores a date in the body and saves for today", async () => {
    const { app, saves } = setup();
    const res = await put(app, "calories", { minimum: 1800, maximum: 2200, effective_from: "2030-05-05", date: "2030-05-05", weekday: "saturday" });
    expect(res.statusCode).toBe(200);
    expect(res.json().effective_from).toBe("2026-01-15");
    expect(saves.map((s) => s.effective_from)).toEqual(["2026-01-15"]);
  });

  // cites: REQ-009/AC-005, REQ-009/AC-006
  it("keeps D-1 and changes D after a save on D", async () => {
    let now = TODAY;
    const { app } = setup(true, () => now);
    await put(app, "calories", { minimum: 1800, maximum: 2200 });
    now = NEXT_DAY;
    await put(app, "calories", { minimum: 1900, maximum: 2300 });
    const on = async (date: string) => (await app.inject({ method: "GET", url: `/target-ranges/on/${date}` })).json().calories;
    expect(await on("2026-01-15")).toMatchObject({ minimum: 1800, maximum: 2200 });
    expect(await on("2026-01-16")).toMatchObject({ minimum: 1900, maximum: 2300 });
  });

  // cites: A-033, REQ-009/AC-005
  it("overwrites the first save when a second save is made on the same day", async () => {
    const { app } = setup();
    await put(app, "calories", { minimum: 1800, maximum: 2200 });
    await put(app, "calories", { minimum: 1900, maximum: 2300 });
    const body = (await app.inject({ method: "GET", url: "/target-ranges" })).json();
    expect(body.calories).toMatchObject({ minimum: 1900, maximum: 2300 });
  });

  // cites: REQ-009/AC-001
  it("turns setup_complete true after the third nutrient is saved", async () => {
    const { app } = setup();
    const complete = async () => (await app.inject({ method: "GET", url: "/target-ranges" })).json().setup_complete;
    await put(app, "calories", { minimum: 1800, maximum: 2200 });
    await put(app, "protein", { minimum: 80, maximum: 120 });
    expect(await complete()).toBe(false);
    await put(app, "fat", { minimum: 50, maximum: 70 });
    expect(await complete()).toBe(true);
  });
});
