import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScreenView } from "./App";
import type { Screen } from "./flow";

const noop = () => undefined;

function render(screen: Screen): string {
  return renderToString(
    <ScreenView screen={screen} onLogin={noop} onLogout={noop} onPhoto={noop} onCreate={noop} onAddAnother={noop} />,
  );
}

const manual = (over: Partial<Extract<Screen, { name: "manual" }>> = {}): Screen => ({
  name: "manual",
  values: {},
  errors: {},
  notice: null,
  ...over,
});

describe("add by hand", () => {
  // cites: REQ-002/AC-001
  it("offers Add by hand next to Add from photo", () => {
    const html = render({ name: "add" });
    expect(html).toContain("Add from photo");
    expect(html).toContain("Add by hand");
  });

  // cites: REQ-002/AC-001, REQ-002/AC-004, REQ-002/AC-009, REQ-002/AC-008
  it("shows every field as a decimal text input", () => {
    const html = render(manual());
    for (const f of ["name", "shop", "brand", "calories", "protein", "fat", "carbohydrate", "sugars", "fibre", "salt", "portion_size", "portion_calories", "piece_weight"]) {
      expect(html).toContain(`name="${f}"`);
    }
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('type="text"');
  });

  // cites: REQ-002/AC-010
  it("has exactly one shop field", () => {
    expect(render(manual()).split('name="shop"').length - 1).toBe(1);
  });

  // cites: REQ-002/AC-007
  it("says a per 100 ml value is entered as the same number", () => {
    expect(render(manual())).toContain("per 100 ml, enter the same numbers");
  });

  // cites: REQ-002/AC-002, REQ-002/AC-003
  it("marks the fields in errors and keeps the values", () => {
    const html = render(manual({ values: { name: "Product A" }, errors: { shop: "This is required" } }));
    expect(html).toContain('value="Product A"');
    expect(html).toContain('data-testid="error-shop"');
    expect(html).not.toContain('data-testid="error-name"');
  });

  // cites: REQ-002/AC-015
  it("shows the duplicate notice", () => {
    expect(render(manual({ notice: "A product with that name and shop already exists. Nothing was saved." }))).toContain("name and shop already exists");
  });
});

describe("saved screen with new values", () => {
  const product = { id: "p-1", name: "Product A", shop: "Shop A", calories: 120, protein: 5, fat: 3, source: "manual" as const };

  // cites: REQ-002/AC-008, REQ-002/AC-005
  it("shows brand, set values, sodium and the piece weight", () => {
    const html = render({
      name: "saved",
      product: { ...product, brand: "Brand A", salt: 1.5, sodium: 600, piece_weight: 50, counted_by_piece: true, portion_size: 10, portion_calories: 37.7 },
    });
    expect(html).toContain("Brand: Brand A");
    expect(html).toContain("Salt: 1.5 g per 100 g");
    expect(html).toContain("Sodium: 600 mg per 100 g");
    expect(html).toContain("Counted by the piece: 50 g");
    expect(html).toContain("Portion size: 10 g");
    expect(html).toContain("Portion calories: 37.7 kcal");
  });

  // cites: REQ-002/AC-006, REQ-002/AC-011, REQ-002/AC-012
  it("shows 0 mg sodium and no piece line when there is no salt or piece weight", () => {
    const html = render({ name: "saved", product: { ...product, sodium: 0, counted_by_piece: false } });
    expect(html).toContain("Sodium: 0 mg per 100 g");
    expect(html).not.toContain("Counted by the piece");
  });
});
