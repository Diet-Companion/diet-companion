import { describe, expect, it } from "vitest";
import type { FetchLike } from "./api";
import { createLogApi } from "./logApi";

function fake(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(body === null ? null : JSON.stringify(body), { status });
  };
  return { api: createLogApi(fn, () => "run-1"), calls };
}

const SHEET = {
  kind: "log",
  date: "2026-01-05",
  today: "2026-01-05",
  closed: false,
  editable: true,
  meals: [
    { meal: "breakfast", has_plan: true, entries: [] },
    { meal: "lunch", has_plan: false, entries: [] },
  ],
};

const EGG = { id: "p1", name: "egg", calories: 140, deleted: false, replaced_by: null };
const ENTRY = { id: "e1", meal: "lunch", position: 0, product: EGG, dish: null, grams: null, pieces: 2, weight_grams: 100 };

describe("log api", () => {
  // cites: REQ-014/AC-013, IF-001@1.5.0#getDayLog
  it("reads a day with the run id header, the server today and has_plan of each meal", async () => {
    const { api, calls } = fake(200, SHEET);
    const result = await api.getDayLog("2026-01-05");
    expect(calls[0]?.url).toBe("/days/2026-01-05/log");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.headers).toEqual({ "X-Run-Id": "run-1" });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.day.today).toBe("2026-01-05");
    expect(result.day.meals.map((m) => m.hasPlan)).toEqual([true, false]);
  });

  // cites: REQ-014/AC-008, IF-001@1.5.0#addLogEntry
  it("posts a pieces entry and reads the weight the response gives", async () => {
    const { api, calls } = fake(201, ENTRY);
    const result = await api.addLogEntry("2026-01-05", { meal: "lunch", product_id: "p1", pieces: 2 });
    expect(calls[0]?.url).toBe("/days/2026-01-05/log/entries");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ meal: "lunch", product_id: "p1", pieces: 2 });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.entry.weightGrams).toBe(100);
    expect(result.entry.caloriesPer100).toBe(140);
  });

  // cites: REQ-014/AC-002, IF-001@1.5.0#changeLogEntry
  it("patches the amount of an entry", async () => {
    const { api, calls } = fake(200, { ...ENTRY, pieces: null, grams: 80, weight_grams: 80 });
    const result = await api.changeLogEntry("2026-01-05", "e1", { grams: 80 });
    expect(calls[0]?.url).toBe("/days/2026-01-05/log/entries/e1");
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ grams: 80 });
    expect(result.kind).toBe("ok");
  });

  // cites: IF-001@1.5.0#removeLogEntry
  it("removes an entry and reads 401 as unauthorized", async () => {
    const ok = fake(204, null);
    expect((await ok.api.removeLogEntry("2026-01-05", "e1")).kind).toBe("ok");
    expect(ok.calls[0]?.url).toBe("/days/2026-01-05/log/entries/e1");
    expect(ok.calls[0]?.init?.method).toBe("DELETE");
    const denied = fake(401, { code: "auth.required", message: "Log in." });
    expect((await denied.api.removeLogEntry("2026-01-05", "e1")).kind).toBe("unauthorized");
  });

  // cites: REQ-014/AC-001, IF-001@1.5.0#confirmMealAsPlanned
  it("confirms a meal as planned and reads the copied entries", async () => {
    const { api, calls } = fake(201, { entries: [ENTRY] });
    const result = await api.confirmMealAsPlanned("2026-01-05", "lunch");
    expect(calls[0]?.url).toBe("/days/2026-01-05/log/meals/lunch/confirm");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(result.kind === "ok" && result.entries.length).toBe(1);
  });

  // cites: REQ-014/AC-009, REQ-014/AC-011
  it("reads the code and reasons of a refusal", async () => {
    const invalid = fake(400, { code: "entry.invalid", message: "No.", reasons: ["piece_without_weight"] });
    const r1 = await invalid.api.addLogEntry("2026-01-05", { meal: "lunch", product_id: "p2", pieces: 1 });
    expect(r1.kind === "refused" && r1.error.code).toBe("entry.invalid");
    expect(r1.kind === "refused" && r1.error.reasons).toEqual(["piece_without_weight"]);
    const closed = fake(409, { code: "day.closed", message: "Closed." });
    const r2 = await closed.api.confirmMealAsPlanned("2026-01-05", "lunch");
    expect(r2.kind === "refused" && r2.error.code).toBe("day.closed");
  });
});
