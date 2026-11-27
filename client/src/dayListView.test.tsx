import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DayListItem, LogDay } from "./logApi";
import { LogView } from "./LogView";
import type { LogState } from "./logScreenLogic";
import { MEALS } from "./planApi";

const noop = () => undefined;
const T = "2026-03-10";

function logDay(date: string): LogDay {
  return { date, today: T, closed: false, editable: date <= T, meals: MEALS.map((meal) => ({ meal, hasPlan: false, entries: [] })) };
}

function item(date: string, state: "open" | "closed", openPast: boolean): DayListItem {
  return { date, state, openPast, closedAt: null };
}

function render(dayList: LogState["dayList"], error: LogState["error"] = null): string {
  const state: LogState = { today: T, day: logDay(T), forms: {}, edits: {}, error, ...(dayList ? { dayList } : {}) };
  return renderToString(
    <LogView
      state={state}
      products={[]}
      dishes={[]}
      busy={false}
      onForm={noop}
      onSubmit={noop}
      onEdit={noop}
      onChange={noop}
      onRemove={noop}
      onConfirm={noop}
      onEarlier={noop}
      onLater={noop}
      onBack={noop}
      onDays={noop}
      onDayPick={noop}
      onDayMore={noop}
    />,
  );
}

const ITEMS = [item(T, "open", false), item("2026-03-09", "open", true), item("2026-03-08", "closed", false)];

describe("day list view", () => {
  // cites: REQ-016/AC-001
  it("offers the Days control and shows day-list only once it is open", () => {
    expect(render(undefined)).toContain('data-testid="log-days"');
    expect(render(undefined)).not.toContain('data-testid="day-list"');
    expect(render({ open: false, items: ITEMS, nextBefore: null })).not.toContain('data-testid="day-list"');
    expect(render({ open: true, items: ITEMS, nextBefore: null })).toContain('data-testid="day-list"');
  });

  // cites: REQ-016/AC-004, REQ-016/AC-005
  it("marks only the day with open_past true; a closed day and today have no mark", () => {
    const html = render({ open: true, items: ITEMS, nextBefore: null });
    expect(html).toContain('data-testid="day-list-open-mark-2026-03-09"');
    expect(html).not.toContain("day-list-open-mark-2026-03-08");
    expect(html).not.toContain(`day-list-open-mark-${T}`);
  });

  // cites: REQ-016/AC-001, REQ-016/AC-004, REQ-016/AC-005
  it("shows each day as a day-list-item-D button in the order sent, with its state in data-state", () => {
    const html = render({ open: true, items: ITEMS, nextBefore: null });
    expect(html).toMatch(/data-testid="day-list-item-2026-03-10"[^>]*data-state="open"/);
    expect(html).toMatch(/data-testid="day-list-item-2026-03-09"[^>]*data-state="open"/);
    expect(html).toMatch(/data-testid="day-list-item-2026-03-08"[^>]*data-state="closed"/);
    expect(html.indexOf("day-list-item-2026-03-10")).toBeLessThan(html.indexOf("day-list-item-2026-03-09"));
    expect(html.indexOf("day-list-item-2026-03-09")).toBeLessThan(html.indexOf("day-list-item-2026-03-08"));
  });

  // cites: REQ-016/AC-003
  it("shows a past day with a plan and no log entries as open with its mark when the server says so", () => {
    const html = render({ open: true, items: [item("2026-03-05", "open", true)], nextBefore: null });
    expect(html).toMatch(/data-testid="day-list-item-2026-03-05"[^>]*data-state="open"/);
    expect(html).toContain('data-testid="day-list-open-mark-2026-03-05"');
  });

  // cites: REQ-016/AC-001
  it("shows day-list-more only while next_before is not null", () => {
    expect(render({ open: true, items: ITEMS, nextBefore: "2026-03-08" })).toContain('data-testid="day-list-more"');
    expect(render({ open: true, items: ITEMS, nextBefore: null })).not.toContain("day-list-more");
  });

  // cites: REQ-016/AC-001
  it("shows a failed list read in log-error and keeps the rest of the log screen", () => {
    const error = { code: "failed", reasons: [] as string[], text: "The list is not available." };
    const html = render(undefined, error);
    expect(html).toContain('data-testid="log-error"');
    expect(html).toContain('data-testid="log-days"');
    expect(html).toContain('data-testid="log-screen"');
    expect(html).toContain("log-entry-save-breakfast");
  });
});
