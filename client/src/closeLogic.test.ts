import { describe, expect, it } from "vitest";
import { canClose, closeStep, readReminders } from "./closeLogic";
import type { LogCloseApi, LogDay } from "./logApi";
import { submitEntry, type LogDeps, type LogState } from "./logScreenLogic";
import { MEALS, type OpenDaysApi, type PlanError } from "./planApi";

const T = "2026-03-10";

function openDay(date: string): LogDay {
  return {
    date,
    today: T,
    closed: false,
    editable: date <= T,
    meals: MEALS.map((meal) => ({ meal, hasPlan: false, entries: [] })),
  };
}

function closedCopy(date: string): LogDay {
  return {
    ...openDay(date),
    closed: true,
    editable: false,
    result: {
      ranges_source: "closed_copy",
      nutrients: [{ nutrient: "calories", unit: "kcal", total: 1300, minimum: null, maximum: null, status: "no_range", signed_number: null }],
    },
  };
}

function stateOf(day: LogDay): LogState {
  return { today: T, day, forms: {}, edits: {}, error: null };
}

function refusal(code: string): PlanError {
  return { code, reasons: [], message: null };
}

// A fake close API: records the dates it is asked for and answers as the spec says (IF-001@1.6.0#closeDay).
function fakeClose(refuse: PlanError | null = null) {
  const calls: string[] = [];
  const api: LogCloseApi = {
    async closeDay(date) {
      calls.push(date);
      if (refuse) return { kind: "refused", error: refuse };
      return { kind: "ok", day: closedCopy(date) };
    },
  };
  return { api, calls };
}

function shownState(next: Awaited<ReturnType<typeof closeStep>>["next"]): LogState {
  if (next.kind !== "state") throw new Error("expected a state");
  return next.state;
}

describe("closeStep", () => {
  // cites: REQ-011/AC-010, REQ-011/AC-001
  it("closes an empty day on confirm and shows the returned closed sheet with its result", async () => {
    const { api, calls } = fakeClose();
    const asked = await closeStep(api, stateOf(openDay(T)), false, "ask");
    expect(asked.confirming).toBe(true);
    const done = await closeStep(api, shownState(asked.next), asked.confirming, "confirm");
    expect(calls).toEqual([T]);
    const s = shownState(done.next);
    expect(done.confirming).toBe(false);
    expect(s.day.closed).toBe(true);
    expect(s.day.editable).toBe(false);
    expect(s.day.result?.nutrients[0]?.total).toBe(1300);
    expect(s.error).toBeNull();
  });

  // cites: REQ-011/AC-008
  it("closes today before the day has ended", async () => {
    const { api, calls } = fakeClose();
    const done = await closeStep(api, stateOf(openDay(T)), true, "confirm");
    expect(calls).toEqual([T]);
    expect(shownState(done.next).day.closed).toBe(true);
  });

  // cites: REQ-011/AC-002
  it("calls nothing on cancel and the day stays open", async () => {
    const { api, calls } = fakeClose();
    const cancelled = await closeStep(api, stateOf(openDay(T)), true, "cancel");
    expect(calls).toEqual([]);
    expect(cancelled.confirming).toBe(false);
    expect(shownState(cancelled.next).day.closed).toBe(false);
  });

  // cites: REQ-016/AC-003
  it("never calls closeDay without the confirm step after ask", async () => {
    const { api, calls } = fakeClose();
    await closeStep(api, stateOf(openDay(T)), false, "confirm");
    await closeStep(api, stateOf(openDay(T)), false, "ask");
    await closeStep(api, stateOf(openDay("2026-03-08")), false, "ask");
    expect(calls).toEqual([]);
  });

  // cites: REQ-011/AC-011
  it("offers no close for a closed day or a day after today, and never calls closeDay for them", async () => {
    expect(canClose(stateOf(openDay("2026-03-11")))).toBe(false);
    expect(canClose(stateOf(closedCopy("2026-03-09")))).toBe(false);
    expect(canClose(stateOf(openDay("2026-03-09")))).toBe(true);
    const { api, calls } = fakeClose();
    await closeStep(api, stateOf(openDay("2026-03-11")), true, "confirm");
    await closeStep(api, stateOf(closedCopy("2026-03-09")), true, "confirm");
    expect(calls).toEqual([]);
  });

  // cites: REQ-016/AC-002, IF-001@1.6.0#closeDay
  it("shows a refusal with its code and keeps the day as it was", async () => {
    for (const code of ["day.closed", "close.day_out_of_range"]) {
      const { api } = fakeClose(refusal(code));
      const before = stateOf(openDay(T));
      const done = await closeStep(api, before, true, "confirm");
      const s = shownState(done.next);
      expect(s.error?.code).toBe(code);
      expect(s.day).toEqual(before.day);
    }
  });

  // cites: IF-001@1.6.0#closeDay
  it("asks for login on unauthorized and shows a failure for a failed call", async () => {
    const login: LogCloseApi = { closeDay: async () => ({ kind: "unauthorized" }) };
    expect((await closeStep(login, stateOf(openDay(T)), true, "confirm")).next.kind).toBe("unauthorized");
    const broken: LogCloseApi = { closeDay: async () => ({ kind: "failed", message: null }) };
    const s = shownState((await closeStep(broken, stateOf(openDay(T)), true, "confirm")).next);
    expect(s.error?.code).toBe("failed");
    expect(s.day.closed).toBe(false);
  });
});

describe("a write refused on a closed day", () => {
  // cites: REQ-011/AC-003, REQ-016/AC-002
  it("keeps the shown totals and result as they were and shows day.closed", async () => {
    const closed = closedCopy("2026-03-09");
    const deps = {
      log: {
        addLogEntry: async () => ({ kind: "refused" as const, error: refusal("day.closed") }),
        getDayLog: async () => ({ kind: "ok" as const, day: openDay("2026-03-09") }),
      },
    } as unknown as LogDeps;
    const next = await submitEntry(deps, stateOf(closed), "lunch");
    if (next.kind !== "state") throw new Error("expected a state");
    expect(next.state.error?.code).toBe("day.closed");
    expect(next.state.day).toEqual(closed);
    expect(next.state.day.result?.nutrients[0]?.total).toBe(1300);
  });
});

// A fake server of open days: the dates before `before` that are not closed (IF-001@1.6.0#getOpenDays).
function fakeServer(open: string[]) {
  const openSet = new Set(open);
  const asked: string[] = [];
  const api: OpenDaysApi & LogCloseApi = {
    async getOpenDays(before) {
      asked.push(before);
      const days = [...openSet].filter((d) => d < before).sort();
      return { kind: "ok", open: { firstDayOfUse: null, before, days } };
    },
    async closeDay(date) {
      openSet.delete(date);
      return { kind: "ok", day: closedCopy(date) };
    },
  };
  return { api, asked };
}

describe("readReminders", () => {
  // cites: REQ-011/AC-004, REQ-011/AC-012
  it("reminds of today, open, while the next day is planned, asking before each shown day", async () => {
    const { api, asked } = fakeServer([T]);
    const r = await readReminders(api, [T, "2026-03-11"]);
    expect(asked).toEqual([T, "2026-03-11"]);
    expect(r).toEqual({ "2026-03-11": [T] });
  });

  // cites: REQ-011/AC-013
  it("reminds of D-2 open with D-1 closed while today is planned", async () => {
    const { api } = fakeServer(["2026-03-08"]);
    const r = await readReminders(api, [T]);
    expect(r[T]).toEqual(["2026-03-08"]);
  });

  // cites: REQ-011/AC-006, REQ-011/AC-011
  it("has no reminder when days is empty", async () => {
    const { api } = fakeServer([]);
    expect(await readReminders(api, [T, "2026-03-11"])).toEqual({});
  });

  // cites: REQ-011/AC-012
  it("has no reminder when getOpenDays fails or is not available, and does not throw", async () => {
    const failing: OpenDaysApi = { getOpenDays: async () => ({ kind: "failed", message: null }) };
    expect(await readReminders(failing, [T])).toEqual({});
    expect(await readReminders({}, [T])).toEqual({});
  });

  // cites: REQ-016/AC-006
  it("keeps D-1 in the next reminder after D is closed", async () => {
    const { api } = fakeServer(["2026-03-09", T]);
    const before = await readReminders(api, ["2026-03-11"]);
    expect(before["2026-03-11"]).toEqual(["2026-03-09", T]);
    await closeStep(api, stateOf(openDay(T)), true, "confirm");
    const after = await readReminders(api, ["2026-03-11"]);
    expect(after["2026-03-11"]).toEqual(["2026-03-09"]);
  });
});
