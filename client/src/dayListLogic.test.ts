import { describe, expect, it } from "vitest";
import type { DayListItem, DayListPage, LogDay, LogDayListResult } from "./logApi";
import { moreDays, pickDay, toggleDayList, type LogDeps, type LogState } from "./logScreenLogic";
import { MEALS } from "./planApi";

const T = "2026-03-10";

function logDay(date: string): LogDay {
  return { date, today: T, closed: false, editable: date <= T, meals: MEALS.map((meal) => ({ meal, hasPlan: false, entries: [] })) };
}

function item(date: string, state: "open" | "closed", openPast: boolean): DayListItem {
  return { date, state, openPast, closedAt: state === "closed" ? "2026-03-09T08:00:00Z" : null };
}

function page(items: DayListItem[], nextBefore: string | null): DayListPage {
  return { firstDayOfUse: "2025-01-01", items, nextBefore };
}

function setup(pages: LogDayListResult[]) {
  const listCalls: (string | undefined)[] = [];
  const dayCalls: string[] = [];
  let n = 0;
  const deps = {
    log: {
      getDayLog: async (date: string) => {
        dayCalls.push(date);
        return { kind: "ok" as const, day: logDay(date) };
      },
      listDays: async (before?: string) => {
        listCalls.push(before);
        const r = pages[n] ?? { kind: "failed" as const, message: null };
        n += 1;
        return r;
      },
    },
  } as unknown as LogDeps;
  const state: LogState = { today: T, day: logDay(T), forms: {}, edits: {}, error: null };
  return { deps, state, listCalls, dayCalls };
}

function stateOf(next: Awaited<ReturnType<typeof toggleDayList>>): LogState {
  if (next.kind !== "state") throw new Error("expected a state");
  return next.state;
}

describe("day list controller", () => {
  // cites: REQ-016/AC-001, REQ-016/AC-004, REQ-016/AC-005
  it("opens with the first page, sent without before, keeping state and open_past as the server sent them", async () => {
    const items = [item(T, "open", false), item("2026-03-09", "open", true), item("2026-03-08", "closed", false)];
    const { deps, state, listCalls } = setup([{ kind: "ok", list: page(items, "2026-03-08") }]);
    const next = stateOf(await toggleDayList(deps, state));
    expect(listCalls).toEqual([undefined]);
    expect(next.dayList).toEqual({ open: true, items, nextBefore: "2026-03-08" });
  });

  // cites: REQ-016/AC-003
  it("keeps a past day with a plan and nothing logged as open when the server says so", async () => {
    const items = [item("2026-03-05", "open", true)];
    const { deps, state } = setup([{ kind: "ok", list: page(items, null) }]);
    const next = stateOf(await toggleDayList(deps, state));
    expect(next.dayList?.items[0]).toEqual({ date: "2026-03-05", state: "open", openPast: true, closedAt: null });
  });

  // cites: REQ-016/AC-001
  it("loads the next page with next_before, appends it, and stops when next_before is null", async () => {
    const first = [item(T, "open", false), item("2026-03-09", "closed", false)];
    const second = [item("2026-03-08", "open", true)];
    const { deps, state, listCalls } = setup([
      { kind: "ok", list: page(first, "2026-03-09") },
      { kind: "ok", list: page(second, null) },
    ]);
    const opened = stateOf(await toggleDayList(deps, state));
    const more = stateOf(await moreDays(deps, opened));
    expect(listCalls).toEqual([undefined, "2026-03-09"]);
    expect(more.dayList?.items.map((i) => i.date)).toEqual([T, "2026-03-09", "2026-03-08"]);
    expect(more.dayList?.nextBefore).toBe(null);
    const end = stateOf(await moreDays(deps, more));
    expect(listCalls).toHaveLength(2);
    expect(end.dayList?.items).toHaveLength(3);
  });

  // cites: REQ-016/AC-001
  it("opens a day 400 days before today from the list and closes the list", async () => {
    const far = "2025-02-03";
    const { deps, state, dayCalls } = setup([{ kind: "ok", list: page([item(far, "closed", false)], null) }]);
    const opened = stateOf(await toggleDayList(deps, state));
    const next = stateOf(await pickDay(deps, opened, far));
    expect(dayCalls).toEqual([far]);
    expect(next.day.date).toBe(far);
    expect(next.dayList?.open).toBe(false);
  });

  // cites: REQ-016/AC-001
  it("hides an open list without another read", async () => {
    const { deps, state, listCalls } = setup([{ kind: "ok", list: page([item(T, "open", false)], null) }]);
    const opened = stateOf(await toggleDayList(deps, state));
    const hidden = stateOf(await toggleDayList(deps, opened));
    expect(hidden.dayList?.open).toBe(false);
    expect(listCalls).toHaveLength(1);
  });

  // cites: REQ-016/AC-001
  it("shows a failed listDays in the error and keeps the day on screen", async () => {
    const { deps, state } = setup([{ kind: "failed", message: "The list is not available." }]);
    const next = stateOf(await toggleDayList(deps, state));
    expect(next.error?.code).toBe("failed");
    expect(next.error?.text).toBe("The list is not available.");
    expect(next.day.date).toBe(T);
    expect(next.dayList?.open).not.toBe(true);
  });

  // cites: REQ-016/AC-001
  it("asks for a new login when listDays is unauthorized", async () => {
    const { deps, state } = setup([{ kind: "unauthorized" }]);
    expect(await toggleDayList(deps, state)).toEqual({ kind: "unauthorized" });
  });
});
