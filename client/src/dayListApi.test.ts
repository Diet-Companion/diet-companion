import { describe, expect, it } from "vitest";
import type { FetchLike } from "./api";
import { createLogApi } from "./logApi";

function fake(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(body === null ? null : JSON.stringify(body), { status });
  };
  return { log: createLogApi(fn, () => "run-1"), calls };
}

const PAGE = {
  first_day_of_use: "2026-01-05",
  items: [
    { date: "2026-03-10", state: "open", open_past: false, closed_at: null },
    { date: "2026-03-09", state: "open", open_past: true, closed_at: null },
    { date: "2026-03-08", state: "closed", open_past: false, closed_at: "2026-03-09T08:00:00Z" },
  ],
  next_before: "2026-03-08",
};

describe("log api: listDays", () => {
  // cites: REQ-016/AC-001, REQ-016/AC-004, REQ-016/AC-005, IF-001@1.6.0#listDays
  it("asks for the first page with no before and reads items and next_before as sent", async () => {
    const { log, calls } = fake(200, PAGE);
    const r = await log.listDays();
    expect(calls[0]?.url).toBe("/days");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.headers).toEqual({ "X-Run-Id": "run-1" });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.list.nextBefore).toBe("2026-03-08");
    expect(r.list.items).toEqual([
      { date: "2026-03-10", state: "open", openPast: false, closedAt: null },
      { date: "2026-03-09", state: "open", openPast: true, closedAt: null },
      { date: "2026-03-08", state: "closed", openPast: false, closedAt: "2026-03-09T08:00:00Z" },
    ]);
  });

  // cites: REQ-016/AC-001, IF-001@1.6.0#listDays
  it("sends before and limit as query parameters and reads a null next_before", async () => {
    const { log, calls } = fake(200, { first_day_of_use: null, items: [], next_before: null });
    const r = await log.listDays("2026-03-08", 31);
    expect(calls[0]?.url).toBe("/days?before=2026-03-08&limit=31");
    expect(r.kind === "ok" && r.list.nextBefore).toBe(null);
  });

  // cites: REQ-016/AC-001, IF-001@1.6.0#listDays
  it("reads 401 as unauthorized, 400 and a network or malformed reply as failed", async () => {
    expect((await fake(401, { code: "auth.required" }).log.listDays()).kind).toBe("unauthorized");
    const bad = await fake(400, { code: "bad.request", message: "Bad date." }).log.listDays("nope");
    expect(bad).toEqual({ kind: "failed", message: "Bad date." });
    expect((await fake(200, { items: [{ date: 1 }], next_before: null }).log.listDays()).kind).toBe("failed");
    expect((await fake(200, { items: [] }).log.listDays()).kind).toBe("failed");
    const down: FetchLike = async () => {
      throw new Error("offline");
    };
    expect((await createLogApi(down, () => "run-1").listDays()).kind).toBe("failed");
  });
});
