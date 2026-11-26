import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { LogView } from "./LogView";
import type { LogDay, LogEntry } from "./logApi";
import type { LogState } from "./logScreenLogic";
import { MEALS, type PlanSubject } from "./planApi";
import { gateAfterRanges } from "./targets";
import type { TargetRange, TargetRanges } from "./targetsApi";

const noop = () => undefined;
const signedIn = { getItem: () => "1", setItem: () => undefined, removeItem: () => undefined };
const TODAY = "2026-03-10";

function subject(name: string): PlanSubject {
  return { id: `id-${name}`, name, deleted: false, replaced: false };
}

function entry(id: string, meal: LogEntry["meal"], name: string, grams: number | null, pieces: number | null = null, weight: number | null = grams): LogEntry {
  return { id, meal, product: subject(name), dish: null, grams, pieces, weightGrams: weight, caloriesPer100: 100 };
}

function day(date: string, entries: LogEntry[] = [], plan: string[] = [], closed = false): LogDay {
  return {
    date,
    today: TODAY,
    closed,
    editable: !closed,
    meals: MEALS.map((meal) => ({ meal, hasPlan: plan.includes(meal), entries: entries.filter((e) => e.meal === meal) })),
  };
}

function state(d: LogDay, extra: Partial<LogState> = {}): LogState {
  return { today: TODAY, day: d, forms: {}, edits: {}, error: null, ...extra };
}

function render(s: LogState): string {
  return renderToString(
    <LogView
      state={s}
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
    />,
  );
}

describe("log view", () => {
  // cites: REQ-014/AC-003, REQ-014/AC-002
  it("shows one day with the five meals, each with its form and stable ids", () => {
    const html = render(state(day(TODAY)));
    expect(html).toContain('data-testid="log-screen"');
    expect(html.match(/data-testid="log-day-date"/g)?.length).toBe(1);
    for (const m of ["breakfast", "brunch", "lunch", "afternoon_snack", "dinner"]) {
      for (const id of ["log-meal", "log-entry-form", "log-entry-select", "log-entry-grams", "log-entry-pieces", "log-entry-save"]) {
        expect(html).toContain(`data-testid="${id}-${m}"`);
      }
    }
  });

  // cites: REQ-014/AC-013, REQ-014/AC-001
  it("shows Confirm as planned only for a meal with a plan", () => {
    const html = render(state(day(TODAY, [], ["lunch"])));
    expect(html).toContain('data-testid="log-confirm-lunch"');
    expect(html).toContain("Confirm as planned");
    expect(html).not.toContain('data-testid="log-confirm-dinner"');
    expect(html).not.toContain('data-testid="log-confirm-breakfast"');
  });

  // cites: REQ-014/AC-002, REQ-014/AC-007
  it("shows an entry at its meal with an amount field and a remove control", () => {
    const html = render(state(day(TODAY, [entry("e1", "lunch", "rice", 120)])));
    expect(html).toContain('data-testid="log-entry-row-e1"');
    expect(html).toContain('data-testid="log-entry-amount-e1"');
    expect(html).toContain('data-testid="log-entry-remove-e1"');
    expect(html).toContain('value="120"');
    const lunch = html.indexOf('data-testid="log-meal-lunch"');
    const dinner = html.indexOf('data-testid="log-meal-dinner"');
    const row = html.indexOf('data-testid="log-entry-row-e1"');
    expect(row).toBeGreaterThan(lunch);
    expect(row).toBeLessThan(dinner);
  });

  // cites: REQ-014/AC-003, REQ-014/AC-008
  it("shows a piece entry in pieces with its weight in grams", () => {
    const html = render(state(day(TODAY, [entry("e2", "brunch", "egg", null, 2, 120)])));
    expect(html).toContain('value="2"');
    expect(html).toContain("pieces");
    expect(html).toContain("(120 g)");
  });

  // cites: REQ-014/AC-004
  it("shows a dish entry whole, with no amount input", () => {
    const dishEntry: LogEntry = { id: "e3", meal: "dinner", product: null, dish: subject("stew"), grams: null, pieces: null, weightGrams: null, caloriesPer100: null };
    const html = render(state(day(TODAY, [dishEntry])));
    expect(html).toContain("stew");
    expect(html).toContain("Whole dish");
    expect(html).toContain('data-testid="log-entry-amount-e3"');
  });

  // cites: REQ-014/AC-006
  it("shows no limit or warning against the plan", () => {
    const html = render(state(day(TODAY, [entry("e1", "lunch", "rice", 900)], ["lunch"])));
    expect(html).not.toMatch(/limit|exceed|over the plan|warning/i);
    expect(html).not.toContain('role="alert"');
  });

  // cites: REQ-014/AC-009
  it("shows the piece-weight refusal in log-error with its code and reasons", () => {
    const error = { code: "entry.invalid", reasons: ["piece_without_weight"], text: "No piece weight." };
    const html = render(state(day(TODAY), { error }));
    expect(html).toContain('data-testid="log-error"');
    expect(html).toContain('data-code="entry.invalid"');
    expect(html).toContain('data-reasons="piece_without_weight"');
    expect(render(state(day(TODAY)))).not.toContain("log-error");
  });

  // cites: REQ-014/AC-011
  it("shows the closed-day refusal in log-error and still offers the forms", () => {
    const error = { code: "day.closed", reasons: [], text: "This day is closed and cannot be changed. Nothing was saved." };
    const html = render(state(day("2026-03-09", [], [], true), { error }));
    expect(html).toContain('data-code="day.closed"');
    expect(html).toContain("This day is closed.");
    expect(html).toContain('data-testid="log-entry-save-lunch"');
  });

  // cites: REQ-014/AC-009, REQ-014/AC-003
  it("keeps the amount as typed in the form after a refused save", () => {
    const forms = { [`${TODAY}|lunch`]: { subject: "", grams: "", pieces: "3" } };
    const html = render(state(day(TODAY), { forms }));
    expect(html).toContain('value="3"');
  });

  // cites: REQ-014/AC-003
  it("offers earlier days, and no later day once today is shown", () => {
    const onToday = render(state(day(TODAY)));
    expect(onToday).toContain('data-testid="log-earlier"');
    expect(onToday).not.toContain('data-testid="log-later"');
    const earlier = render(state(day("2026-03-09")));
    expect(earlier).toContain('data-testid="log-later"');
  });
});

function range(nutrient: TargetRange["nutrient"], minimum: number, maximum: number): TargetRange {
  return { nutrient, minimum, maximum, unit: nutrient === "calories" ? "kcal" : "g", effective_from: "2026-01-05" };
}

const COMPLETE: TargetRanges = {
  as_of: "2026-01-05",
  setup_complete: true,
  calories: range("calories", 1800, 2200),
  protein: range("protein", 80, 120),
  fat: range("fat", 50, 70),
};

describe("app navigation to the log", () => {
  // cites: REQ-014/AC-003
  it("has a Meal log entry once setup is complete", () => {
    const html = renderToString(<App storage={signedIn} initialGate={gateAfterRanges({ kind: "ok", ranges: COMPLETE })} />);
    expect(html).toContain('data-testid="open-log"');
    expect(html).toContain("Meal log");
  });
});
