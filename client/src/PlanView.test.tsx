import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { PlanView } from "./PlanView";
import { MEALS, type DaySheet, type PlanEntry, type PlanSubject } from "./planApi";
import type { PlanState } from "./planScreenLogic";
import { gateAfterRanges } from "./targets";
import type { TargetRange, TargetRanges } from "./targetsApi";

const noop = () => undefined;
const signedIn = { getItem: () => "1", setItem: () => undefined, removeItem: () => undefined };

function subject(name: string, marks: Partial<PlanSubject> = {}): PlanSubject {
  return { id: `id-${name}`, name, deleted: false, replaced: false, ...marks };
}

function day(date: string, entries: PlanEntry[] = [], closed = false): DaySheet {
  return {
    date,
    today: "2026-03-10",
    closed,
    editable: !closed,
    meals: MEALS.map((meal) => ({ meal, entries: entries.filter((e) => e.meal === meal) })),
  };
}

function entry(id: string, meal: PlanEntry["meal"], product: PlanSubject | null, dish: PlanSubject | null, grams: number | null): PlanEntry {
  return { id, meal, product, dish, grams, pieces: null };
}

function state(days: DaySheet[], extra: Partial<PlanState> = {}): PlanState {
  return { today: "2026-03-10", days, forms: {}, edits: {}, error: null, ...extra };
}

function render(s: PlanState): string {
  return renderToString(
    <PlanView state={s} products={[]} dishes={[]} busy={false} onForm={noop} onSubmit={noop} onEdit={noop} onChange={noop} onRemove={noop} onBack={noop} />,
  );
}

describe("plan view", () => {
  // cites: REQ-013/AC-001, REQ-013/AC-002
  it("shows today and the next day, each with the five meals and their stable ids", () => {
    const html = render(state([day("2026-03-10"), day("2026-03-11")]));
    expect(html).toContain('data-testid="plan-screen"');
    expect(html).toContain("2026-03-10");
    expect(html).toContain("2026-03-11");
    expect(html).not.toContain("2026-03-12");
    for (const m of ["breakfast", "brunch", "lunch", "afternoon_snack", "dinner"]) {
      for (const id of ["plan-meal", "plan-entry-form", "plan-entry-select", "plan-entry-grams", "plan-entry-pieces", "plan-entry-save"]) {
        expect(html).toContain(`data-testid="${id}-${m}"`);
      }
    }
    expect(html.match(/data-testid="plan-day-date"/g)?.length).toBe(2);
  });

  // cites: REQ-013/AC-001
  it("shows a dish entry whole and a product entry with its grams, with the row ids", () => {
    const entries = [
      entry("e1", "breakfast", null, subject("omelette"), null),
      entry("e2", "lunch", subject("rice"), null, 100),
    ];
    const html = render(state([day("2026-03-10"), day("2026-03-11", entries)]));
    expect(html).toContain('data-testid="plan-entry-row-e1"');
    expect(html).toContain('data-testid="plan-entry-remove-e1"');
    expect(html).toContain("omelette");
    expect(html).toContain('data-testid="plan-entry-amount-e2"');
    expect(html).toContain('value="100"');
    expect(html).toContain('data-testid="plan-entry-remove-e2"');
  });

  // cites: IF-001@1.5.0#getDayPlan, R-006
  it("shows the deleted and replaced marks from the response", () => {
    const entries = [
      entry("e1", "lunch", subject("Old rice", { deleted: true }), null, 100),
      entry("e2", "dinner", null, subject("Old stew", { replaced: true }), null),
    ];
    const html = render(state([day("2026-03-10", entries), day("2026-03-11")]));
    expect(html).toContain("Old rice (deleted)");
    expect(html).toContain("Old stew (replaced)");
  });

  // cites: REQ-013/AC-007, REQ-013/AC-008, A-001
  it("shows the error code in data-code and the reasons in data-reasons", () => {
    const error = { code: "entry.invalid", reasons: ["piece_without_weight"], text: "No piece weight." };
    const html = render(state([day("2026-03-10"), day("2026-03-11")], { error }));
    expect(html).toContain('data-testid="plan-error"');
    expect(html).toContain('data-code="entry.invalid"');
    expect(html).toContain('data-reasons="piece_without_weight"');
    expect(render(state([day("2026-03-10"), day("2026-03-11")]))).not.toContain("plan-error");
  });

  // cites: REQ-013/AC-006
  it("keeps the amount as typed in the form after a refused save", () => {
    const forms = { "2026-03-10|lunch": { subject: "", grams: "150.5", pieces: "" } };
    const html = render(state([day("2026-03-10"), day("2026-03-11")], { forms }));
    expect(html).toContain('value="150.5"');
  });

  // cites: REQ-013/AC-007
  it("still offers the forms on a closed day, so the server decides", () => {
    const html = render(state([day("2026-03-10", [], true), day("2026-03-11")]));
    expect(html).toContain("This day is closed.");
    expect(html.match(/data-testid="plan-entry-save-lunch"/g)?.length).toBe(2);
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

describe("app navigation", () => {
  // cites: REQ-013/AC-002
  it("has a Daily plan entry next to the other entries once setup is complete", () => {
    const html = renderToString(<App storage={signedIn} initialGate={gateAfterRanges({ kind: "ok", ranges: COMPLETE })} />);
    expect(html).toContain('data-testid="open-plan"');
    expect(html).toContain("Daily plan");
    expect(html).toContain('data-testid="open-targets"');
  });
});
