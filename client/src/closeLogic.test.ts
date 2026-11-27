import { describe, expect, it, vi } from "vitest";
import { canClose, confirmClose, readReminders } from "./closeLogic";
import type { LogCloseResult, LogDay } from "./logApi";
import { earlierDay, openLog, submitEntry, type LogDeps, type LogState } from "./logScreenLogic";
import { MEALS, type OpenDaysResult } from "./planApi";

const T = "2026-03-10";

function day(date: string, closed = false): LogDay {
  return {
    date,
    today: T,
    closed,
    editable: !closed && date <= T,
    meals: MEALS.map((meal) => ({ meal, hasPlan: false, entries: [] })),
  };
}

function closedWithResult(date: string): LogDay {
  return {
    ...day(date, true),
    result: {
      ranges_source: "closed_copy",
      nutrients: [{ nutrient: "calories", unit: "kcal", total: 1300, minimum: null, maximum: null, status: "no_range", signed_number: null }],
    },
  };
}

function stateOf(d: LogDay): LogState {
  return { today: T, day: d, forms: {}, edits: {}, error: null };
}

function depsWith(closeDay: (date: string) => Promise<LogCloseResult>): LogDeps {
  return { log: { closeDay } } as unknown as LogDeps;
}

describe("canClose", () => {
  // cites: REQ-011/AC-001, REQ-011/AC-011
  it("allows an open day that is today or earlier and no other", () => {
    expect(canClose(day(T))).toBe(true);
    expect(canClose(day("2026-03-09"))).toBe(true);
    expect(canClose(day("2026-03-11"))).toBe(false);
    expect(canClose(day("2026-03-09", true))).toBe(false);
  });
});

describe("confirmClose", () => {
  // cites: REQ-011/AC-010, REQ-011/AC-008
  it("closes today and an empty day with closeDay and shows the returned sheet with its result", async () => {
    const closeDay = vi.fn(async (date: string): Promise<LogCloseResult> => ({ kind: "ok", day: closedWithResult(date) }));
    for (const date of [T, "2026-03-09"]) {
      const next = await confirmClose(depsWith(closeDay), stateOf(day(date)));
      if (next.kind !== "state") throw new Error("expected state");
      expect(next.state.day.date).toBe(date);
      expect(next.state.day.closed).toBe(true);
      expect(next.state.day.editable).toBe(false);
      expect(next.state.day.result?.nutrients[0]?.total).toBe(1300);
      expect(next.state.error).toBeNull();
    }
    expect(closeDay.mock.calls.map((c) => c[0])).toEqual([T, "2026-03-09"]);
  });

  // cites: REQ-011/AC-011
  it("never calls closeDay for a day after today", async () => {
    const closeDay = vi.fn(async (date: string): Promise<LogCloseResult> => ({ kind: "ok", day: day(date, true) }));
    const state = stateOf(day("2026-03-11"));
    const next = await confirmClose(depsWith(closeDay), state);
    expect(closeDay).not.toHaveBeenCalled();
    expect(next).toEqual({ kind: "state", state });
  });

  // cites: REQ-016/AC-002, REQ-011/AC-003
  it("shows a day.closed refusal in the error and keeps the shown day as it was", async () => {
    const closeDay = async (): Promise<LogCloseResult> => ({
      kind: "refused",
      error: { code: "day.closed", reasons: [], message: null },
    });
    const state = stateOf(day("2026-03-09"));
    const next = await confirmClose(depsWith(closeDay), state);
    if (next.kind !== "state") throw new Error("expected state");
    expect(next.state.error?.code).toBe("day.closed");
    expect(next.state.day).toBe(state.day);
  });

  // cites: REQ-011/AC-011
  it("shows a close.day_out_of_range refusal with its code and changes nothing else", async () => {
    const closeDay = async (): Promise<LogCloseResult> => ({
      kind: "refused",
      error: { code: "close.day_out_of_range", reasons: [], message: null },
    });
    const state = stateOf(day(T));
    const next = await confirmClose(depsWith(closeDay), state);
    if (next.kind !== "state") throw new Error("expected state");
    expect(next.state.error?.code).toBe("close.day_out_of_range");
    expect({ ...next.state, error: null }).toEqual(state);
  });

  // cites: REQ-011/AC-010
  it("sends the Owner to login on 401", async () => {
    const next = await confirmClose(depsWith(async () => ({ kind: "unauthorized" })), stateOf(day(T)));
    expect(next.kind).toBe("unauthorized");
  });
});

describe("a closed day and automatic closing", () => {
  // cites: REQ-016/AC-002, REQ-011/AC-003
  it("keeps the closed day's result when a write is refused with day.closed", async () => {
    const addLogEntry = async () => ({
      kind: "refused" as const,
      error: { code: "day.closed", reasons: [] as string[], message: null },
    });
    const deps = { log: { addLogEntry } } as unknown as LogDeps;
    const state = stateOf(closedWithResult("2026-03-09"));
    const next = await submitEntry(deps, state, "lunch");
    if (next.kind !== "state") throw new Error("expected state");
    expect(next.state.error?.code).toBe("day.closed");
    expect(next.state.day).toBe(state.day);
    expect(next.state.day.result?.nutrients[0]?.total).toBe(1300);
  });

  // cites: REQ-016/AC-003, REQ-011/AC-002
  it("does not call closeDay when the log is opened or another day is shown", async () => {
    const closeDay = vi.fn(async (date: string): Promise<LogCloseResult> => ({ kind: "ok", day: day(date, true) }));
    const getDayLog = async (date: string) => ({ kind: "ok", day: day(date) });
    const deps = {
      log: { getDayLog, closeDay },
      targets: { getTargetRanges: async () => ({ kind: "ok", ranges: { as_of: T } }) },
      products: { listProducts: async () => ({ kind: "ok", products: [] }) },
      dishes: { listDishes: async () => ({ kind: "ok", dishes: [] }) },
    } as unknown as LogDeps;
    const opened = await openLog(deps);
    if (opened.kind !== "ok") throw new Error("expected ok");
    const earlier = await earlierDay(deps, opened.state);
    if (earlier.kind !== "state") throw new Error("expected state");
    expect(earlier.state.day.date).toBe("2026-03-09");
    expect(earlier.state.day.closed).toBe(false);
    expect(closeDay).not.toHaveBeenCalled();
  });
});

// A fake server: open days before a date, oldest first; closing a day removes it from the list.
function server(open: string[]) {
  const set = new Set(open);
  const asked: string[] = [];
  return {
    asked,
    plan: {
      getOpenDays: async (before: string): Promise<OpenDaysResult> => {
        asked.push(before);
        return { kind: "ok", days: [...set].filter((d) => d < before).sort() };
      },
    },
    close: (d: string) => set.delete(d),
  };
}

describe("readReminders", () => {
  // cites: REQ-011/AC-004, REQ-011/AC-012
  it("asks once per shown day with before set to that day, and keeps today open while planning the next day", async () => {
    const s = server([T]);
    const found = await readReminders(s.plan, [T, "2026-03-11"]);
    expect([...s.asked].sort()).toEqual([T, "2026-03-11"]);
    expect(found).toEqual({ "2026-03-11": [T] });
  });

  // cites: REQ-011/AC-013
  it("lists D-2 open while planning today when D-1 is closed, taking the dates as the server sends them", async () => {
    const s = server(["2026-03-08"]);
    const found = await readReminders(s.plan, [T]);
    expect(found).toEqual({ [T]: ["2026-03-08"] });
  });

  // cites: REQ-011/AC-004
  it("keeps the server's order", async () => {
    const plan = { getOpenDays: async (): Promise<OpenDaysResult> => ({ kind: "ok", days: ["2026-03-07", "2026-03-08", "2026-03-09"] }) };
    expect(await readReminders(plan, [T])).toEqual({ [T]: ["2026-03-07", "2026-03-08", "2026-03-09"] });
  });

  // cites: REQ-011/AC-006, REQ-011/AC-011
  it("has no reminder when days is empty", async () => {
    expect(await readReminders(server([]).plan, [T, "2026-03-11"])).toEqual({});
  });

  // cites: REQ-011/AC-012
  it("has no reminder, and does not throw, when the read fails, is refused, throws or does not exist", async () => {
    expect(await readReminders({ getOpenDays: async () => ({ kind: "failed", message: null }) }, [T])).toEqual({});
    expect(await readReminders({ getOpenDays: async () => ({ kind: "unauthorized" }) }, [T])).toEqual({});
    const throwing = {
      getOpenDays: async (): Promise<OpenDaysResult> => {
        throw new Error("offline");
      },
    };
    expect(await readReminders(throwing, [T])).toEqual({});
    expect(await readReminders({}, [T])).toEqual({});
  });

  // cites: REQ-016/AC-006
  it("after closing D, the next reminder still lists D-1", async () => {
    const s = server(["2026-03-09", T]);
    expect(await readReminders(s.plan, ["2026-03-11"])).toEqual({ "2026-03-11": ["2026-03-09", T] });
    s.close(T);
    expect(await readReminders(s.plan, ["2026-03-11"])).toEqual({ "2026-03-11": ["2026-03-09"] });
  });
});
