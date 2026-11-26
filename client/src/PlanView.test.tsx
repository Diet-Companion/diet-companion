import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DaySheet } from "./planApi";
import { PlanView, type PlanViewProps } from "./PlanView";

const noop = () => undefined;

function sheet(date: string, closed: boolean, editable: boolean): DaySheet {
  const rice = { id: "p1", name: "rice", deleted: false, replaced: true };
  const omelette = { id: "d1", name: "omelette", deleted: true, replaced: false };
  return {
    date,
    today: "2026-01-05",
    closed,
    editable,
    meals: [
      { meal: "breakfast", entries: [{ id: "e1", meal: "breakfast", product: null, dish: omelette, grams: null, pieces: null }] },
      { meal: "lunch", entries: [{ id: "e2", meal: "lunch", product: rice, dish: null, grams: 100, pieces: null }] },
    ],
  };
}

function render(patch: Partial<PlanViewProps> = {}): string {
  return renderToString(
    <PlanView
      sheets={[sheet("2026-01-05", true, false), sheet("2026-01-06", false, true)]}
      products={[{ id: "p1", name: "rice" }]}
      dishes={[{ id: "d1", name: "omelette" }]}
      forms={{}}
      error={null}
      onForm={noop}
      onSave={noop}
      onRemove={noop}
      onBack={noop}
      {...patch}
    />,
  );
}

describe("plan view", () => {
  // cites: REQ-013/AC-002, REQ-013/AC-003
  it("shows today and the next day, each with five meals, and a form for the next day while today is closed", () => {
    const html = render();
    expect(html).toContain('data-testid="plan-screen"');
    expect(html.match(/data-testid="plan-day-date"/g)?.length).toBe(2);
    for (const m of ["breakfast", "brunch", "lunch", "afternoon_snack", "dinner"]) {
      expect(html.match(new RegExp(`data-testid="plan-meal-${m}"`, "g"))?.length).toBe(2);
      for (const part of ["form", "select", "grams", "pieces", "save"]) {
        expect(html).toContain(`data-testid="plan-entry-${part}-${m}"`);
      }
    }
    expect(html).toContain('data-testid="plan-day-2026-01-06"');
  });

  // cites: REQ-013/AC-001
  it("shows each entry with its product or dish, its marks and a remove button", () => {
    const html = render();
    expect(html).toContain('data-testid="plan-entry-row-e1"');
    expect(html).toContain("omelette (deleted)");
    expect(html).toContain("rice (replaced)");
    expect(html).toContain("100 g");
    expect(html).toContain('data-testid="plan-entry-remove-e2"');
  });

  // cites: REQ-013/AC-004, REQ-013/AC-007
  it("shows a refusal in plan-error with its code", () => {
    const out = render({ error: { code: "plan.day_out_of_range", reasons: [], message: null } });
    expect(out).toContain('data-testid="plan-error"');
    expect(out).toContain('data-code="plan.day_out_of_range"');
    expect(render({ error: { code: "day.closed", reasons: [], message: null } })).toContain('data-code="day.closed"');
    expect(render()).not.toContain("plan-error");
  });

  // cites: REQ-013/AC-006, REQ-013/AC-008
  it("keeps the form as typed after a refusal and shows the reason", () => {
    const html = render({
      forms: { "2026-01-06|lunch": { subject: "p:p1", grams: "150.5", pieces: "2" } },
      error: { code: "entry.invalid", reasons: ["amount_invalid", "piece_without_weight"], message: null },
    });
    expect(html).toContain('value="150.5"');
    expect(html).toContain('value="2"');
    expect(html).toContain('data-code="entry.invalid"');
    expect(html).toContain('data-reasons="amount_invalid,piece_without_weight"');
  });
});
