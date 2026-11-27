import { describe, expect, it } from "vitest";
import type { FetchLike } from "./api";
import { createLogApi } from "./logApi";
import { createPlanApi } from "./planApi";

function fake(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(body === null ? null : JSON.stringify(body), { status });
  };
  return { log: createLogApi(fn, () => "run-1"), plan: createPlanApi(fn, () => "run-1"), calls };
}

const CLOSED_SHEET = {
  date: "2026-03-10",
  today: "2026-03-10",
  closed: true,
  editable: false,
  meals: [],
  result: {
    ranges_source: "closed_copy",
    nutrients: [
      { nutrient: "calories", unit: "kcal", total: 1300, minimum: null, maximum: null, status: "no_range", signed_number: null },
    ],
  },
};

describe("log api: closeDay", () => {
  // cites: REQ-011/AC-010, REQ-011/AC-008, IF-001@1.6.0#closeDay
  it("posts to the day's close path and reads the closed sheet with its fixed result", async () => {
    const { log, calls } = fake(200, CLOSED_SHEET);
    const r = await log.closeDay("2026-03-10");
    expect(calls[0]?.url).toBe("/days/2026-03-10/close");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({ "X-Run-Id": "run-1" });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.day.closed).toBe(true);
    expect(r.day.editable).toBe(false);
    expect(r.day.result?.ranges_source).toBe("closed_copy");
    expect(r.day.result?.nutrients[0]?.total).toBe(1300);
  });

  // cites: REQ-016/AC-002, IF-001@1.6.0#closeDay
  it("reads day.closed (409) as a refusal", async () => {
    const r = await fake(409, { code: "day.closed", message: "Closed." }).log.closeDay("2026-03-09");
    expect(r.kind === "refused" && r.error.code).toBe("day.closed");
  });

  // cites: REQ-011/AC-011, IF-001@1.6.0#closeDay
  it("reads close.day_out_of_range (422) as a refusal, 401 as unauthorized, and a broken reply as failed", async () => {
    const range = await fake(422, { code: "close.day_out_of_range" }).log.closeDay("2026-03-11");
    expect(range.kind === "refused" && range.error.code).toBe("close.day_out_of_range");
    expect((await fake(401, { code: "auth.required" }).log.closeDay("2026-03-10")).kind).toBe("unauthorized");
    expect((await fake(200, { nope: true }).log.closeDay("2026-03-10")).kind).toBe("failed");
  });
});

describe("plan api: getOpenDays", () => {
  // cites: REQ-011/AC-004, IF-001@1.6.0#getOpenDays
  it("asks with before and reads the dates in the order sent", async () => {
    const body = { first_day_of_use: "2026-03-08", before: "2026-03-10", days: ["2026-03-08", "2026-03-09"] };
    const { plan, calls } = fake(200, body);
    const r = await plan.getOpenDays("2026-03-10");
    expect(calls[0]?.url).toBe("/days/open?before=2026-03-10");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(r).toEqual({ kind: "ok", days: ["2026-03-08", "2026-03-09"] });
  });

  // cites: REQ-011/AC-006, IF-001@1.6.0#getOpenDays
  it("reads an empty list as ok with no days", async () => {
    const body = { first_day_of_use: null, before: "2026-03-10", days: [] };
    expect(await fake(200, body).plan.getOpenDays("2026-03-10")).toEqual({ kind: "ok", days: [] });
  });

  // cites: REQ-011/AC-012, IF-001@1.6.0#getOpenDays
  it("reads 401, an error status and a malformed body without throwing", async () => {
    expect((await fake(401, { code: "auth.required" }).plan.getOpenDays("2026-03-10")).kind).toBe("unauthorized");
    expect((await fake(400, { code: "bad.request" }).plan.getOpenDays("2026-03-10")).kind).toBe("failed");
    expect((await fake(200, { days: [1] }).plan.getOpenDays("2026-03-10")).kind).toBe("failed");
  });
});
