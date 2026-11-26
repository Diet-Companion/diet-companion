import { describe, expect, it } from "vitest";
import type { FetchLike } from "./api";
import { createPlanApi } from "./planApi";

function fake(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(body === null ? null : JSON.stringify(body), { status });
  };
  return { api: createPlanApi(fn, () => "run-1"), calls };
}

const SHEET = {
  kind: "plan",
  date: "2026-01-06",
  today: "2026-01-05",
  closed: false,
  editable: true,
  meals: [{ meal: "breakfast", has_plan: false, entries: [] }],
};

const RICE = { id: "p1", name: "rice", deleted: true, replaced_by: null };
const ENTRY = { id: "e1", meal: "lunch", position: 0, product: RICE, dish: null, grams: 100, pieces: null };

describe("plan api", () => {
  // cites: IF-001@1.5.0#getDayPlan
  it("reads a day with the run id header and the server today", async () => {
    const { api, calls } = fake(200, SHEET);
    const result = await api.getDayPlan("2026-01-06");
    expect(calls[0]?.url).toBe("/days/2026-01-06/plan");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.headers).toEqual({ "X-Run-Id": "run-1" });
    expect(result.kind === "ok" && result.sheet.today).toBe("2026-01-05");
  });

  // cites: REQ-013/AC-001, IF-001@1.5.0#addPlanEntry
  it("posts a whole dish without an amount and reads the saved entry with its marks", async () => {
    const { api, calls } = fake(201, ENTRY);
    const result = await api.addPlanEntry("2026-01-06", { meal: "breakfast", dish_id: "d1" });
    expect(calls[0]?.url).toBe("/days/2026-01-06/plan/entries");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ meal: "breakfast", dish_id: "d1" });
    expect(result.kind === "ok" && result.entry.product?.deleted).toBe(true);
  });

  // cites: REQ-013/AC-006, IF-001@1.5.0#addPlanEntry
  it("sends 150.5 as typed and returns the refusal code and reasons", async () => {
    const { api, calls } = fake(400, { code: "entry.invalid", message: "x", reasons: ["amount_invalid"] });
    const result = await api.addPlanEntry("2026-01-05", { meal: "lunch", product_id: "p1", grams: 150.5 });
    expect(JSON.parse(String(calls[0]?.init?.body)).grams).toBe(150.5);
    expect(result).toEqual({ kind: "refused", error: { code: "entry.invalid", reasons: ["amount_invalid"], message: "x" } });
  });

  // cites: REQ-013/AC-004, REQ-013/AC-007, IF-001@1.5.0#addPlanEntry
  it("returns the out of range and closed day codes", async () => {
    const out = await fake(422, { code: "plan.day_out_of_range", message: "x" }).api.addPlanEntry("d", { meal: "lunch" });
    const closed = await fake(409, { code: "day.closed", message: "x" }).api.addPlanEntry("d", { meal: "lunch" });
    expect(out.kind === "refused" && out.error.code).toBe("plan.day_out_of_range");
    expect(closed.kind === "refused" && closed.error.code).toBe("day.closed");
  });

  // cites: IF-001@1.5.0#changePlanEntry
  it("patches the amount of an entry", async () => {
    const { api, calls } = fake(200, ENTRY);
    await api.changePlanEntry("2026-01-05", "e1", { grams: 120 });
    expect(calls[0]?.url).toBe("/days/2026-01-05/plan/entries/e1");
    expect(calls[0]?.init?.method).toBe("PATCH");
  });

  // cites: IF-001@1.5.0#removePlanEntry
  it("deletes an entry and answers unauthorized on 401", async () => {
    const ok = fake(204, null);
    expect(await ok.api.removePlanEntry("2026-01-05", "e1")).toEqual({ kind: "ok" });
    expect(ok.calls[0]?.init?.method).toBe("DELETE");
    expect(await fake(401, { code: "auth.required", message: "x" }).api.removePlanEntry("d", "e1")).toEqual({
      kind: "unauthorized",
    });
  });
});
