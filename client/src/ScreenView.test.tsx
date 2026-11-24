import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DUPLICATE_TEXT, FAILED_TEXT, ScreenView } from "./App";
import type { Screen } from "./flow";

const noop = () => undefined;

function render(screen: Screen): string {
  return renderToString(
    <ScreenView screen={screen} onLogin={noop} onLogout={noop} onPhoto={noop} onCreate={noop} onAddAnother={noop} />,
  );
}

describe("screens", () => {
  // cites: REQ-003/AC-010
  it("shows a password form on the login screen", () => {
    const html = render({ name: "login", error: null });
    expect(html).toContain('type="password"');
  });

  // cites: REQ-003/AC-010
  it("shows one photo control that opens the camera or picker, with no confirmation step", () => {
    const html = render({ name: "add" });
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('capture="environment"');
    expect(html).toContain("Add from photo");
    expect(html).not.toContain("Confirm");
  });

  // cites: REQ-003/AC-010
  it("says the product was saved and shows name, shop and values per 100 g", () => {
    const html = render({
      name: "saved",
      product: { id: "p-1", name: "Product A", shop: "Shop A", calories: 120, protein: 5, fat: 3, source: "label" },
    });
    expect(html).toContain("Product saved.");
    expect(html).toContain("Name: Product A");
    expect(html).toContain("Shop: Shop A");
    expect(html).toContain("Calories: 120 kcal per 100 g");
    expect(html).toContain("Protein: 5 g per 100 g");
    expect(html).toContain("Fat: 3 g per 100 g");
    expect(html).toContain("Add another");
  });

  // cites: REQ-003/AC-002
  it("asks only for the shop when the shop is missing", () => {
    const html = render({ name: "missing", missing: ["shop"], recognised: { name: "Product A", calories: 1, protein: 1, fat: 1 } });
    expect(html).toContain('name="shop"');
    expect(html).not.toContain('name="protein"');
    expect(html).not.toContain('name="name"');
  });

  // cites: REQ-003/AC-003
  it("asks for protein in g per 100 g", () => {
    const html = render({ name: "missing", missing: ["protein"], recognised: {} });
    expect(html).toContain('name="protein"');
    expect(html).toContain("Protein (g per 100 g)");
  });

  // cites: REQ-003/AC-004
  it("asks for the name when it is missing", () => {
    const html = render({ name: "missing", missing: ["name"], recognised: {} });
    expect(html).toContain('name="name"');
  });

  // cites: REQ-003/AC-007
  it("asks for calories in kcal per 100 g, as a decimal text field", () => {
    const html = render({ name: "missing", missing: ["calories"], recognised: {} });
    expect(html).toContain('name="calories"');
    expect(html).toContain("Calories (kcal per 100 g)");
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('type="text"');
  });

  // cites: REQ-003/AC-008
  it("asks for fat in g per 100 g", () => {
    const html = render({ name: "missing", missing: ["fat"], recognised: {} });
    expect(html).toContain('name="fat"');
    expect(html).toContain("Fat (g per 100 g)");
  });

  // cites: REQ-003/AC-011, REQ-003/AC-012, REQ-003/AC-013
  it("shows the server message once on the duplicate screen", () => {
    const html = render({ name: "duplicate", message: "Already there" });
    expect(html).toContain("Already there");
    expect(html).not.toContain(DUPLICATE_TEXT);
  });

  // cites: REQ-003/AC-011
  it("shows the fixed text on the duplicate screen when there is no server message", () => {
    const html = render({ name: "duplicate", message: null });
    expect(html).toContain("A product with that name and shop already exists");
  });

  // cites: REQ-003/AC-010
  it("shows the server message, or the fixed text, on the failed screen", () => {
    expect(render({ name: "failed", message: "Unreadable" })).toContain("Unreadable");
    expect(render({ name: "failed", message: "Unreadable" })).not.toContain("Try again.");
    expect(render({ name: "failed", message: null })).toContain("The photo couldn&#x27;t be read. Try again.");
    expect(FAILED_TEXT).toContain("couldn't be read");
  });
});
