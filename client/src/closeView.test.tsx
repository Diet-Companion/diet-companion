import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LogDay } from "./logApi";
import { LogView } from "./LogView";
import type { LogState } from "./logScreenLogic";
import { MEALS, type DaySheet } from "./planApi";
import type { PlanState } from "./planScreenLogic";
import { PlanView } from "./PlanView";

const noop = () => undefined;
const TODAY = "2026-03-10";

function logDay(date: string, closed = false): LogDay {
  return {
    date,
    today: TODAY,
    closed,
    editable: !closed && date <= TODAY,
    meals: MEALS.map((meal) => ({ meal, hasPlan: false, entries: [] })),
  };
}

// A closed day as closeDay returns it: the fixed result is on the sheet.
function closedWithResult(date: string): LogDay {
  return {
    ...logDay(date, true),
    result: {
      ranges_source: "closed_copy",
      nutrients: [{ nutrient: "calories", unit: "kcal", total: 1300, minimum: null, maximum: null, status: "no_range", signed_number: null }],
    },
  };
}

function renderLog(d: LogDay, confirmingClose = false, error: LogState["error"] = null): string {
  const state: LogState = { today: TODAY, day: d, forms: {}, edits: {}, error };
  return renderToString(
    <LogView
      state={state}
      products={[]}
      dishes={[]}
      busy={false}
      confirmingClose={confirmingClose}
      onForm={noop}
      onSubmit={noop}
      onEdit={noop}
      onChange={noop}
      onRemove={noop}
      onConfirm={noop}
      onEarlier={noop}
      onLater={noop}
      onBack={noop}
    />,
  );
}

function sheet(date: string): DaySheet {
  return { date, today: TODAY, closed: false, editable: true, meals: MEALS.map((meal) => ({ meal, entries: [] })) };
}

function renderPlan(reminders: Record<string, string[]> | undefined): string {
  const state: PlanState = { today: TODAY, days: [sheet(TODAY), sheet("2026-03-11")], forms: {}, edits: {}, error: null };
  return renderToString(
    <PlanView
      state={state}
      products={[]}
      dishes={[]}
      busy={false}
      reminders={reminders}
      onForm={noop}
      onSubmit={noop}
      onEdit={noop}
      onChange={noop}
      onRemove={noop}
      onBack={noop}
    />,
  );
}

describe("close control", () => {
  // cites: REQ-011/AC-001, REQ-011/AC-008
  it("offers log-close on an open day that is today or earlier, by the server's today", () => {
    expect(renderLog(logDay(TODAY))).toContain('data-testid="log-close"');
    expect(renderLog(logDay("2026-03-09"))).toContain('data-testid="log-close"');
  });

  // cites: REQ-011/AC-011
  it("does not offer log-close on a day after today", () => {
    expect(renderLog(logDay("2026-03-11"))).not.toContain('data-testid="log-close"');
  });

  // cites: REQ-016/AC-002
  it("shows log-closed-mark and no close or reopen control on a closed day", () => {
    const html = renderLog(logDay("2026-03-09", true));
    expect(html).toContain('data-testid="log-closed-mark"');
    expect(html).not.toContain('data-testid="log-close"');
    expect(html).not.toMatch(/reopen/i);
    expect(renderLog(logDay(TODAY))).not.toContain("log-closed-mark");
  });

  // cites: REQ-011/AC-001, REQ-011/AC-008, REQ-011/AC-010
  it("shows log-closed-mark and the returned fixed result on the closed sheet, with no close control", () => {
    const html = renderLog(closedWithResult(TODAY));
    expect(html).toContain('data-testid="log-closed-mark"');
    expect(html).toContain('data-testid="log-result-total-calories">1300<');
    expect(html).not.toContain('data-testid="log-close"');
    expect(html).not.toContain("log-close-confirm");
  });

  // cites: REQ-016/AC-002, REQ-011/AC-003
  it("shows the day.closed refusal in log-error and keeps the closed mark and the result", () => {
    const error = { code: "day.closed", reasons: [] as string[], text: "This day is closed and cannot be changed. Nothing was saved." };
    const html = renderLog(closedWithResult("2026-03-09"), false, error);
    expect(html).toContain('data-testid="log-error"');
    expect(html).toContain('data-code="day.closed"');
    expect(html).toContain('data-testid="log-closed-mark"');
    expect(html).toContain('data-testid="log-result-total-calories">1300<');
  });

  // cites: REQ-011/AC-002
  it("asks for confirmation with confirm and cancel instead of closing at once", () => {
    const html = renderLog(logDay(TODAY), true);
    expect(html).toContain('data-testid="log-close-confirm"');
    expect(html).toContain('data-testid="log-close-cancel"');
    expect(html).not.toContain('data-testid="log-close"');
    expect(renderLog(logDay(TODAY))).not.toContain("log-close-confirm");
  });
});

describe("close reminder", () => {
  // cites: REQ-011/AC-004, REQ-011/AC-012
  it("shows the count and one entry per open day, oldest first, in the day's section", () => {
    const html = renderPlan({ "2026-03-11": ["2026-03-08", "2026-03-10"] });
    expect(html).toContain('data-testid="close-reminder"');
    expect(html).toContain('data-testid="close-reminder-count">2<');
    expect(html.indexOf('close-reminder-day-2026-03-08"')).toBeGreaterThan(-1);
    expect(html.indexOf('close-reminder-day-2026-03-08"')).toBeLessThan(html.indexOf('close-reminder-day-2026-03-10"'));
    expect(html.indexOf('data-testid="close-reminder"')).toBeGreaterThan(html.indexOf('data-testid="plan-day-2026-03-11"'));
  });

  // cites: REQ-011/AC-006, REQ-011/AC-011
  it("shows no reminder when there are no open days or none were read", () => {
    expect(renderPlan({})).not.toContain("close-reminder");
    expect(renderPlan(undefined)).not.toContain("close-reminder");
  });

  // cites: REQ-011/AC-012, REQ-011/AC-013
  it("keeps every plan form with or without a reminder", () => {
    const withReminder = renderPlan({ [TODAY]: ["2026-03-08"] });
    const without = renderPlan({});
    for (const meal of MEALS) {
      expect(withReminder).toContain(`data-testid="plan-entry-save-${meal}"`);
      expect(without).toContain(`data-testid="plan-entry-save-${meal}"`);
    }
  });
});
