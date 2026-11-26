import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TargetsEditView } from "./TargetsEditView";
import { applyOutcome, editFromRanges, type EditState } from "./targetsEdit";
import type { Nutrient, TargetRange, TargetRanges } from "./targetsApi";

const noop = () => undefined;

function range(nutrient: Nutrient, minimum: number, maximum: number, effective_from: string): TargetRange {
  return { nutrient, minimum, maximum, unit: nutrient === "calories" ? "kcal" : "g", effective_from };
}

const IN_FORCE: TargetRanges = {
  as_of: "2026-01-05",
  setup_complete: true,
  calories: range("calories", 1800, 2200, "2026-01-01"),
  protein: range("protein", 80, 120, "2026-01-02"),
  fat: range("fat", 50, 70, "2026-01-03"),
};

function render(state: EditState): string {
  return renderToString(<TargetsEditView state={state} onChange={noop} onSave={noop} onBack={noop} />);
}

describe("targets edit view", () => {
  // cites: IF-001@1.4.0#getTargetRanges
  it("shows the screen id, as_of and each range in force with its effective_from", () => {
    const html = render(editFromRanges(IN_FORCE));
    expect(html).toContain('data-testid="targets-edit"');
    expect(html).toContain("Today: 2026-01-05");
    expect(html).toContain("Minimum 1800, maximum 2200 kcal, in force from 2026-01-01.");
    expect(html).toContain("Minimum 80, maximum 120 g, in force from 2026-01-02.");
    expect(html).toContain("Minimum 50, maximum 70 g, in force from 2026-01-03.");
  });

  // cites: REQ-009/AC-008, INT-002#T59/T60
  it("offers the stable ids for calories, protein and fat only", () => {
    const html = render(editFromRanges(IN_FORCE));
    for (const n of ["calories", "protein", "fat"]) {
      expect(html).toContain(`data-testid="target-min-${n}"`);
      expect(html).toContain(`data-testid="target-max-${n}"`);
      expect(html).toContain(`data-testid="target-save-${n}"`);
    }
    expect(html.match(/<form/g)?.length).toBe(3);
    expect(html.toLowerCase()).not.toContain("salt");
  });

  // cites: REQ-009/AC-007, INT-002#T15/T16
  it("offers no per-day or per-weekday option and no date field", () => {
    const html = render(editFromRanges(IN_FORCE)).toLowerCase();
    expect(html).not.toContain("weekday");
    expect(html).not.toContain("saturday");
    expect(html).not.toContain('type="date"');
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("shows no error until a change is refused", () => {
    expect(render(editFromRanges(IN_FORCE))).not.toContain("target-error-");
  });

  // cites: REQ-009/AC-002, REQ-009/AC-003, REQ-009/AC-010
  it("shows each refusal next to its own nutrient, with the range in force still shown", () => {
    let state = editFromRanges(IN_FORCE);
    state = applyOutcome(state, "calories", { kind: "refused", error: "range_inverted" });
    state = applyOutcome(state, "protein", { kind: "refused", error: "values_missing" });
    state = applyOutcome(state, "fat", { kind: "refused", error: "value_invalid" });
    const html = render(state);
    expect(html).toContain('data-testid="target-error-calories" data-code="range_inverted"');
    expect(html).toContain('data-testid="target-error-protein" data-code="values_missing"');
    expect(html).toContain('data-testid="target-error-fat" data-code="value_invalid"');
    expect(html).toContain("Minimum 1800, maximum 2200 kcal, in force from 2026-01-01.");
  });

  // cites: REQ-009/AC-005
  it("shows the new range with today's effective_from after a saved change", () => {
    const state = applyOutcome(editFromRanges(IN_FORCE), "calories", {
      kind: "saved",
      range: range("calories", 1900, 2300, "2026-01-05"),
    });
    expect(render(state)).toContain("Minimum 1900, maximum 2300 kcal, in force from 2026-01-05.");
  });
});
