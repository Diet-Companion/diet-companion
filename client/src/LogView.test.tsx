import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import type { LogDay, LogEntry } from "./logApi";
import { LogView } from "./LogView";
import type { LogState } from "./logScreenLogic";
import { MEALS, type Meal } from "./planApi";
import { gateAfterRanges } from "./targets";

const noop = () => undefined;
const signedIn = { getItem: () => "1", setItem: () => undefined, removeItem: () => undefined };
const TODAY = "2026-03-10";

function day(date: string, opts: { plan?: Meal[]; entries?: LogEntry[]; closed?: boolean } = {}): LogDay {
  const plan = opts.plan ?? [];
  const entries = opts.entries ?? [];
  return {
    date,
    today: TODAY,
    closed: opts.closed ?? false,
    editable: !opts.closed,
    meals: MEALS.map((meal) => ({ meal, hasPlan: plan.includes(meal), entries: entries.filter((e) => e.meal === meal) })),
  };
}

function entry(id: string, meal: Meal, name: string, grams: number | null, pieces: number | null = null): LogEntry {
  return {
    id,
    meal,
    product: { id: `id-${name}`, name, deleted: false, replaced: false },
    dish: null,
    grams,
    pieces,
    weightGrams: pieces !== null ? pieces * 50 : grams,
    caloriesPer100: pieces !== null ? 140 : null,
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
  // cites: REQ-014/AC-003, REQ-014/AC-004
  it("shows one day with the five meals and their stable ids", () => {
    const html = render(state(day(TODAY)));
    expect(html).toContain('data-testid="log-screen"');
    expect(html.match(/data-testid="log-day-date"/g)?.length).toBe(1);
    expect(html).toContain(TODAY);
    for (const m of MEALS) {
      for (const id of ["log-meal", "log-entry-form", "log-entry-select", "log-entry-grams", "log-entry-pieces", "log-entry-save"]) {
        expect(html).toContain(`data-testid="${id}-${m}"`);
      }
    }
  });

  // cites: REQ-014/AC-013
  it("shows confirm as planned for breakfast, which has a plan, and not for lunch", () => {
    const html = render(state(day(TODAY, { plan: ["breakfast"] })));
    expect(html).toContain('data-testid="log-confirm-breakfast"');
    expect(html).toContain("Confirm as planned");
    expect(html).not.toContain('data-testid="log-confirm-lunch"');
  });

  // cites: REQ-014/AC-002, REQ-014/AC-008
  it("shows a grams entry and a pieces entry with their row ids, weight and values", () => {
    const entries = [entry("e1", "lunch", "rice", 100), entry("e2", "lunch", "egg", null, 2)];
    const html = render(state(day(TODAY, { entries })));
    expect(html).toContain('data-testid="log-entry-row-e1"');
    expect(html).toContain('data-testid="log-entry-amount-e1"');
    expect(html).toContain('data-testid="log-entry-remove-e1"');
    expect(html).toContain('value="100"');
    expect(html).toContain('data-testid="log-entry-amount-e2"');
    expect(html).toContain("100 g");
    expect(html).toContain("140 kcal per 100 g");
  });

  // cites: REQ-014/AC-009, REQ-014/AC-011
  it("shows the error code in data-code and the reasons in data-reasons", () => {
    const error = { code: "entry.invalid", reasons: ["piece_without_weight"], text: "No piece weight." };
    const html = render(state(day(TODAY), { error }));
    expect(html).toContain('data-testid="log-error"');
    expect(html).toContain('data-code="entry.invalid"');
    expect(html).toContain('data-reasons="piece_without_weight"');
    expect(render(state(day(TODAY)))).not.toContain("log-error");
  });

  // cites: REQ-014/AC-011
  it("says a closed day is closed and keeps its forms, so the server's refusal can show", () => {
    const html = render(state(day(TODAY, { closed: true })));
    expect(html).toContain("This day is closed.");
    expect(html).toContain('data-testid="log-entry-form-lunch"');
  });

  // cites: REQ-014/AC-003
  it("keeps the typed form values", () => {
    const forms = { [`${TODAY}|lunch`]: { subject: "", grams: "200", pieces: "" } };
    expect(render(state(day(TODAY), { forms }))).toContain('value="200"');
  });

  // cites: REQ-014/AC-013
  it("offers a later day only from a day before today", () => {
    expect(render(state(day(TODAY)))).not.toContain('data-testid="log-day-later"');
    expect(render(state(day("2026-03-09")))).toContain('data-testid="log-day-later"');
    expect(render(state(day(TODAY)))).toContain('data-testid="log-day-earlier"');
  });

  // cites: REQ-014/AC-001
  it("has a Meal log entry next to the other entries once setup is complete", () => {
    const ranges = { as_of: TODAY, setup_complete: true, calories: null, protein: null, fat: null };
    const html = renderToString(<App storage={signedIn} initialGate={gateAfterRanges({ kind: "ok", ranges })} />);
    expect(html).toContain('data-testid="open-log"');
    expect(html).toContain("Meal log");
    expect(html).toContain('data-testid="open-plan"');
  });
});
