import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LogView } from "./LogView";
import type { Dish } from "./dishApi";
import type { LogDay } from "./logApi";
import { chooseSplitDish, openSplit, type LogState } from "./logScreenLogic";
import { MEALS } from "./planApi";

const noop = () => undefined;
const TODAY = "2026-03-10";

const OMELETTE: Dish = {
  id: "d-omelette",
  name: "omelette",
  lines: [
    { position: 0, product: { id: "p-white", name: "egg white" }, grams: 100, pieces: null, weight_grams: 100 },
    { position: 1, product: { id: "p-egg", name: "egg" }, grams: null, pieces: 2, weight_grams: 100 },
  ],
  total_weight_grams: 200,
  replaced_by: null,
  deleted: false,
  selectable: true,
  has_unselectable_product: false,
};

function day(): LogDay {
  return {
    date: TODAY,
    today: TODAY,
    closed: false,
    editable: true,
    meals: MEALS.map((meal) => ({ meal, hasPlan: false, entries: [] })),
  };
}

function base(): LogState {
  return { today: TODAY, day: day(), forms: {}, edits: {}, error: null };
}

function render(s: LogState): string {
  return renderToString(
    <LogView
      state={s}
      products={[]}
      dishes={[OMELETTE]}
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
      onSplitOpen={noop}
      onSplitDish={noop}
      onSplitLine={noop}
      onSplitSave={noop}
    />,
  );
}

describe("log view: log a dish as products", () => {
  // cites: REQ-014/AC-005
  it("offers Log dish as products in every meal and shows no split form until it is opened", () => {
    const html = render(base());
    for (const m of ["breakfast", "brunch", "lunch", "afternoon_snack", "dinner"]) {
      expect(html).toContain(`data-testid="log-split-dish-${m}"`);
      expect(html).not.toContain(`data-testid="log-split-form-${m}"`);
    }
    expect(html).toContain("Log dish as products");
  });

  // cites: REQ-014/AC-005
  it("shows the split form with the dish picker and save control once opened", () => {
    const html = render(openSplit(base(), "lunch"));
    expect(html).toContain('data-testid="log-split-form-lunch"');
    expect(html).toContain('data-testid="log-split-select-lunch"');
    expect(html).toContain('data-testid="log-split-save-lunch"');
    expect(html).not.toContain('data-testid="log-split-form-dinner"');
    expect(html).toContain("omelette");
  });

  // cites: REQ-014/AC-005, REQ-014/AC-010
  it("shows the lines of the chosen dish with the dish amounts prefilled", () => {
    const html = render(chooseSplitDish(openSplit(base(), "lunch"), "lunch", OMELETTE));
    for (const id of ["log-split-line", "log-split-grams", "log-split-pieces"]) {
      expect(html).toContain(`data-testid="${id}-lunch-0"`);
      expect(html).toContain(`data-testid="${id}-lunch-1"`);
    }
    expect(html).toContain("egg white");
    expect(html).toContain('value="100"');
    expect(html).toContain('value="2"');
  });

  // cites: REQ-014/AC-005
  it("shows the refusal in log-error with its code and reasons, and marks the refused line", () => {
    const chosen = chooseSplitDish(openSplit(base(), "lunch"), "lunch", OMELETTE);
    const form = chosen.splits?.[`${TODAY}|lunch`];
    if (!form) throw new Error("no form");
    const s: LogState = {
      ...chosen,
      splits: { [`${TODAY}|lunch`]: { ...form, refused: { 1: "amount_invalid" } } },
      error: { code: "entry.invalid", reasons: ["amount_invalid"], text: "Line 2 (egg): bad amount." },
    };
    const html = render(s);
    expect(html).toContain('data-testid="log-error"');
    expect(html).toContain('data-code="entry.invalid"');
    expect(html).toContain('data-reasons="amount_invalid"');
    expect(html).toContain('data-testid="log-split-line-error-lunch-1"');
    expect(html).not.toContain('data-testid="log-split-line-error-lunch-0"');
  });
});
