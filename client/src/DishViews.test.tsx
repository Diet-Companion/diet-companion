import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Dish } from "./dishApi";
import { DishScreens } from "./DishViews";
import type { DishScreen } from "./dishes";

const noop = () => undefined;

function render(screen: DishScreen): string {
  return renderToString(
    <DishScreens
      screen={screen}
      onFilter={noop}
      onShowView={noop}
      onOpen={noop}
      onRestore={noop}
      onBack={noop}
      onBackToList={noop}
      onAskDelete={noop}
      onCancelDelete={noop}
      onConfirmDelete={noop}
    />,
  );
}

const DISH: Dish = {
  id: "d-1",
  name: "omelette",
  lines: [
    { position: 0, product: { id: "p-1", name: "egg white" }, grams: 100, pieces: null, weight_grams: 100 },
    {
      position: 1,
      product: { id: "p-2", name: "egg", selectable: false },
      grams: null,
      pieces: 2,
      weight_grams: 100,
    },
  ],
  total_weight_grams: 200,
  replaced_by: null,
  deleted: false,
  selectable: true,
  has_unselectable_product: true,
};

describe("dish screens", () => {
  // cites: REQ-006/AC-017
  it("lists two dishes with the same name and shows no duplicate warning", () => {
    const html = render({
      name: "dishes",
      view: "selectable",
      dishes: [DISH, { ...DISH, id: "d-2" }],
      filter: "",
      notice: null,
    });
    expect(html).toContain('data-testid="open-dish-d-1"');
    expect(html).toContain('data-testid="open-dish-d-2"');
    expect(html).not.toContain("already exists");
    expect(html).not.toContain("Restore");
  });

  // cites: REQ-006/AC-016
  it("shows a Restore control on each deleted dish", () => {
    const html = render({ name: "dishes", view: "deleted", dishes: [DISH], filter: "", notice: null });
    expect(html).toContain("Deleted dishes");
    expect(html).toContain('data-testid="restore-dish-d-1"');
  });

  // cites: REQ-006/AC-002, REQ-006/AC-018
  it("shows each line with its product name, amount and weight, and marks a replaced product", () => {
    const html = render({ name: "dish", dish: DISH, confirmDelete: false });
    expect(html).toContain("egg white: 100 g");
    expect(html).toContain("egg: 2 pieces");
    expect(html).toContain("(100 g)");
    expect(html.match(/data-testid="dish-line-marked"/g)).toHaveLength(1);
    expect(html).toContain('data-testid="delete-dish"');
  });

  // cites: REQ-006/AC-011
  it("asks for confirmation in the page before a delete", () => {
    const html = render({ name: "dish", dish: DISH, confirmDelete: true });
    expect(html).toContain('data-testid="confirm-delete-dish"');
    expect(html).not.toContain('data-testid="delete-dish"');
  });
});
