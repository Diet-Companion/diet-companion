import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScreenView } from "./App";
import type { Product } from "./api";
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
  brand: "Brand A",
  calories: 120,
  protein: 5,
  fat: 3,
  source: "manual",
};

describe("catalog screens", () => {
  // cites: REQ-005/AC-004
  it("lists name, shop, brand and calories per 100 g with an open control and no restore", () => {
    const html = render({ name: "catalog", view: "selectable", products: [P], filter: "", notice: null });
    expect(html).toContain("Product A");
    expect(html).toContain("Shop A / Brand A");
    expect(html).toContain("120 kcal per 100 g");
    expect(html).toContain('data-testid="open-p-1"');
    expect(html).not.toContain("Restore");
  });

  // cites: REQ-005/AC-004
  it("hides products that do not match the filter", () => {
    const html = render({ name: "catalog", view: "selectable", products: [P], filter: "zzz", notice: null });
    expect(html).not.toContain('data-testid="open-p-1"');
    expect(html).toContain("No products found.");
  });

  // cites: REQ-005/AC-011
  it("shows a Restore control on each deleted product", () => {
    const html = render({ name: "catalog", view: "deleted", products: [P], filter: "", notice: null });
    expect(html).toContain("Deleted products");
    expect(html).toContain('data-testid="restore-p-1"');
    expect(html).toContain("Restore");
  });

  // cites: REQ-005/AC-015
  it("shows the refusal notice on the deleted list", () => {
    const html = render({
      name: "catalog",
      view: "deleted",
      products: [P],
      filter: "",
      notice: "A product with that name and shop already exists. Nothing was restored.",
    });
    expect(html).toContain("already exists");
    expect(html).toContain('data-testid="restore-p-1"');
  });

  // characterization: the ticket text is the only source of the screen's values
  it("shows all values of an opened product including sodium and counted by the piece", () => {
    const html = render({
      name: "product",
      confirmDelete: false,
      product: { ...P, salt: 1, sodium: 400, piece_weight: 30, counted_by_piece: true },
    });
    expect(html).toContain("Sodium: 400 mg per 100 g");
    expect(html).toContain("Counted by the piece: 30 g");
    expect(html).toContain("Calories: 120 kcal per 100 g");
  });

  // cites: REQ-005/AC-004
  it("asks for the delete confirmation inside the page", () => {
    const before = render({ name: "product", confirmDelete: false, product: P });
    expect(before).toContain('data-testid="delete-product"');
    expect(before).not.toContain('data-testid="confirm-delete"');
    const after = render({ name: "product", confirmDelete: true, product: P });
    expect(after).toContain('data-testid="confirm-delete"');
    expect(after).toContain("Delete this product?");
  });

  // cites: REQ-005/AC-011
  it("offers the Catalog from the add screen", () => {
    const html = render({ name: "add" });
    expect(html).toContain("Catalog");
    expect(html).toContain('data-testid="open-catalog"');
  });
});
