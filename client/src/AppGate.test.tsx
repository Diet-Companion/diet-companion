import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { CHECKING, gateAfterRanges } from "./targets";
import type { TargetRange, TargetRanges } from "./targetsApi";

const signedIn = { getItem: () => "1", setItem: () => undefined, removeItem: () => undefined };
const signedOut = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

const NONE: TargetRanges = { as_of: "2026-01-05", setup_complete: false, calories: null, protein: null, fat: null };

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

describe("app-level targets gate", () => {
  // cites: REQ-009/AC-001
  it("shows only the setup while setup_complete is false", () => {
    const html = renderToString(
      <App storage={signedIn} initialGate={gateAfterRanges({ kind: "ok", ranges: NONE })} />,
    );
    expect(html).toContain('data-testid="targets-setup"');
    expect(html).not.toContain('data-testid="open-targets"');
    expect(html).not.toContain('data-testid="open-dishes"');
    expect(html).not.toContain('data-testid="add"');
  });

  // cites: REQ-009/AC-001
  it("shows the app with the targets navigation entry once setup_complete is true", () => {
    const html = renderToString(
      <App storage={signedIn} initialGate={gateAfterRanges({ kind: "ok", ranges: COMPLETE })} />,
    );
    expect(html).toContain('data-testid="add"');
    expect(html).toContain('data-testid="open-targets"');
    expect(html).not.toContain('data-testid="targets-setup"');
  });

  // cites: REQ-009/AC-001
  it("shows neither the setup nor the app while the ranges are being checked", () => {
    const html = renderToString(<App storage={signedIn} initialGate={CHECKING} />);
    expect(html).toContain('data-testid="targets-checking"');
    expect(html).not.toContain('data-testid="open-targets"');
    expect(html).not.toContain('data-testid="targets-setup"');
  });

  // cites: REQ-009/AC-001
  it("shows the sign-in, not the targets entry, when signed out", () => {
    const html = renderToString(
      <App storage={signedOut} initialGate={gateAfterRanges({ kind: "unauthorized" })} />,
    );
    expect(html).toContain('data-testid="login-form"');
    expect(html).not.toContain('data-testid="open-targets"');
  });
});
