import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TargetsSetupView } from "./TargetsSetupView";
import { initialSetup, setField, withResult, type SetupState } from "./targets";

const noop = () => undefined;
const NONE = { as_of: "2026-01-05", setup_complete: false, calories: null, protein: null, fat: null };

function render(state: SetupState): string {
  return renderToString(<TargetsSetupView state={state} onChange={noop} onSave={noop} />);
}

describe("targets setup view", () => {
  // cites: REQ-009/AC-001
  it("shows the setup with the stable ids for calories, protein and fat", () => {
    const html = render(initialSetup(NONE));
    expect(html).toContain('data-testid="targets-setup"');
    for (const n of ["calories", "protein", "fat"]) {
      expect(html).toContain(`data-testid="target-min-${n}"`);
      expect(html).toContain(`data-testid="target-max-${n}"`);
      expect(html).toContain(`data-testid="target-save-${n}"`);
    }
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("offers no salt or per-day range", () => {
    const html = render(initialSetup(NONE));
    expect(html).not.toContain("salt");
    expect(html).not.toContain("weekday");
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("shows no error until a save is refused", () => {
    expect(render(initialSetup(NONE))).not.toContain("target-error-");
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("shows each error code next to its own nutrient only, with the fields as typed", () => {
    let state = initialSetup(NONE);
    state = setField(state, "protein", "min", "80");
    state = withResult(state, "protein", { saved: false, error: "values_missing", unauthorized: false });
    state = withResult(state, "fat", { saved: false, error: "range_inverted", unauthorized: false });
    state = withResult(state, "calories", { saved: false, error: "value_invalid", unauthorized: false });
    const html = render(state);
    expect(html).toContain('data-testid="target-error-protein" data-code="values_missing"');
    expect(html).toContain('data-testid="target-error-fat" data-code="range_inverted"');
    expect(html).toContain('data-testid="target-error-calories" data-code="value_invalid"');
    expect(html).toContain('value="80"');
  });
});
