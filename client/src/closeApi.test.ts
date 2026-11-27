import { describe, expect, it } from "vitest";
import type { FetchLike } from "./api";
import { createLogApi } from "./logApi";
import { createPlanApi } from "./planApi";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(body === null ? null : JSON.stringify(body), { status });
  };
  return { fn, calls };
}

const CLOSED_SHEET = {
  kind: "log",
  date: "2026-01-05",
  today: "2026-01-05",
  closed: true,
  editable: false,
  meals: [{ meal: "lunch", has_plan: false, entries: [] }],
  result: {
    ranges_source: "closed_copy",
    nutrients: [
      { nutrient: "calories", unit: "kcal", total: 0, minimum: null, maximum: null, status: "no_range", signed_number: null },
    ],
  },
};

describe("closeDay", () => {
  // cites: REQ-011/AC-001, IF-001@1.6.0#closeDay
  it("posts to the close path and returns the closed sheet with its result", async () => {
    const { fn, calls } = fakeFetch(200, CLOSED_SHEET);
    const r = await createLogApi(fn, () => "run-1").closeDay("2026-01-05");
    expect(calls[0]?.url).toBe("/days/2026-01-05/close");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({ "X-Run-Id": "run-1" });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.day.closed).toBe(true);
    expect(r.day.editable).toBe(false);
    expect(r.day.result?.ranges_source).toBe("closed_copy");
  });

  // cites: REQ-016/AC-002, IF-001@1.6.0#closeDay
  it("parses the day.closed refusal of a 409", async () => {
    const { fn } = fakeFetch(409, { code: "day.closed", reasons: [] });
    const r = await createLogApi(fn, () => "run-1").closeDay("2026-01-05");
    if (r.kind !== "refused") throw new Error("expected refused");
    expect(r.error.code).toBe("day.closed");
  });

  // cites: REQ-011/AC-011, IF-001@1.6.0#closeDay
  it("parses the close.day_out_of_range refusal of a 422", async () => {
    const { fn } = fakeFetch(422, { code: "close.day_out_of_range", reasons: [] });
    const r = await createLogApi(fn, () => "run-1").closeDay("2026-01-06");
    if (r.kind !== "refused") throw new Error("expected refused");
    expect(r.error.code).toBe("close.day_out_of_range");
  });

  // cites: IF-001@1.6.0#closeDay
  it("reports a login need on 401 and a failure on a lost connection", async () => {
    const login = await createLogApi(fakeFetch(401, null).fn, () => "run-1").closeDay("2026-01-05");
    expect(login.kind).toBe("unauthorized");
    const lost: FetchLike = async () => {
      throw new Error("offline");
    };
    expect((await createLogApi(lost, () => "run-1").closeDay("2026-01-05")).kind).toBe("failed");
  });
});

describe("getOpenDays", () => {
  // cites: REQ-011/AC-004, IF-001@1.6.0#getOpenDays
  it("reads the open days before a date, in the order the server sends them", async () => {
    const { fn, calls } = fakeFetch(200, { first_day_of_use: "2026-01-01", before: "2026-01-05", days: ["2026-01-02", "2026-01-04"] });
    const r = await createPlanApi(fn, () => "run-1").getOpenDays("2026-01-05");
    expect(calls[0]?.url).toBe("/days/open?before=2026-01-05");
    expect(calls[0]?.init?.method).toBe("GET");
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.open.days).toEqual(["2026-01-02", "2026-01-04"]);
  });

  // cites: REQ-011/AC-006, IF-001@1.6.0#getOpenDays
  it("reads an empty list of days and a null first day of use", async () => {
    const { fn } = fakeFetch(200, { first_day_of_use: null, before: "2026-01-05", days: [] });
    const r = await createPlanApi(fn, () => "run-1").getOpenDays("2026-01-05");
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.open.days).toEqual([]);
    expect(r.open.firstDayOfUse).toBeNull();
  });

  // cites: IF-001@1.6.0#getOpenDays
  it("fails on a 400, a malformed body and a lost connection, and asks for login on 401", async () => {
    const api = (status: number, body: unknown) => createPlanApi(fakeFetch(status, body).fn, () => "run-1");
    expect((await api(400, { code: "bad_request" }).getOpenDays("x")).kind).toBe("failed");
    expect((await api(200, { before: "2026-01-05", days: [1] }).getOpenDays("2026-01-05")).kind).toBe("failed");
    expect((await api(401, null).getOpenDays("2026-01-05")).kind).toBe("unauthorized");
    const lost: FetchLike = async () => {
      throw new Error("offline");
    };
    expect((await createPlanApi(lost, () => "run-1").getOpenDays("2026-01-05")).kind).toBe("failed");
  });
});
