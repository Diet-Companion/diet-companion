import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScreenView } from "./App";
import type { Product } from "./api";
import { productToValues } from "./edit";
import type { Screen } from "./flow";

const noop = () => undefined;

function render(screen: Screen): string {
  return renderToString(
    <ScreenView screen={screen} onLogin={noop} onLogout={noop} onPhoto={noop} onCreate={noop} onAddAnother={noop} />,
  );
}

const P: Product = {
  id: "p-1",
  name: "Product A",
  shop: "Shop A",
  calories: 100,
  protein: 5,
  fat: 3.5,
  carbohydrate: 12.5,
  source: "manual",
};

describe("edit screens", () => {
  // cites: REQ-005/AC-001
  it("offers an Edit button on the product view", () => {
    const html = render({ name: "product", confirmDelete: false, product: P });
    expect(html).toContain('data-testid="edit-product"');
    expect(html).toContain("Edit");
  });

  // cites: REQ-005/AC-009
  it("shows the saved notice on the product view", () => {
    const html = render({ name: "product", confirmDelete: false, product: P, notice: "Saved" });
    expect(html).toContain('data-testid="product-notice"');
    expect(html).toContain("Saved");
  });

  // cites: REQ-005/AC-001
  it("opens the form prefilled with the product values, comma decimals kept", () => {
    const html = render({ name: "edit", product: P, values: productToValues(P), errors: {}, notice: null });
    expect(html).toContain('data-testid="edit-form"');
    expect(html).toContain('value="Product A"');
    expect(html).toContain('value="Shop A"');
    expect(html).toContain('value="3,5"');
    expect(html).toContain('value="12,5"');
    expect(html).toContain("Save changes");
  });

  // cites: REQ-005/AC-014
  it("keeps the typed values and shows the duplicate notice", () => {
    const values = { ...productToValues(P), name: "product a" };
    const html = render({
      name: "edit",
      product: P,
      values,
      errors: {},
      notice: "A product with that name and shop already exists",
    });
    expect(html).toContain('value="product a"');
    expect(html).toContain("A product with that name and shop already exists");
  });

  // cites: IF-001@1.2.0#editProduct
  it("marks a field with its error", () => {
    const html = render({
      name: "edit",
      product: P,
      values: productToValues(P),
      errors: { calories: "Enter a number, 0 or more" },
      notice: null,
    });
    expect(html).toContain('data-testid="error-calories"');
  });
});
