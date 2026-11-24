import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Product } from "./api";
import type { Dish, DishState } from "./dishApi";
import { DishScreens } from "./DishViews";
import {
  DISH_SAVED_NEW_TEXT,
  LINES_REQUIRED_TEXT,
  LINE_NO_PIECE_WEIGHT_TEXT,
  NAME_REQUIRED_TEXT,
  dishToForm,
  emptyErrors,
  emptyForm,
} from "./dishFormLogic";
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
      onNewDish={noop}
      onEditDish={noop}
      onSubmitForm={noop}
      onCancelForm={noop}
    />,
  );
}

const PRODUCTS: Product[] = [
  { id: "p-1", name: "egg white", shop: "corner", calories: 50, protein: 10, fat: 0, source: "manual" },
  {
    id: "p-2",
    name: "egg",
    shop: "corner",
    calories: 140,
    protein: 12,
    fat: 10,
    source: "manual",
    piece_weight: 50,
    counted_by_piece: true,
  },
];

const DISH: Dish = {
  id: "d-1",
  name: "omelette",
  lines: [
    { position: 0, product: { id: "p-1", name: "egg white" }, grams: 100, pieces: null, weight_grams: 100 },
    { position: 1, product: { id: "p-2", name: "egg" }, grams: null, pieces: 2, weight_grams: 100 },
  ],
  total_weight_grams: 200,
  replaced_by: null,
  deleted: false,
  selectable: true,
  has_unselectable_product: false,
};

function listScreen(view: DishState): DishScreen {
  return { name: "dishes", view, filter: "", notice: null, dishes: [DISH] };
}

function formScreen(over: Partial<Extract<DishScreen, { name: "dish_form" }>> = {}): DishScreen {
  return {
    name: "dish_form",
    original: null,
    products: PRODUCTS,
    values: emptyForm(),
    errors: emptyErrors(),
    notice: null,
    ...over,
  };
}

describe("dish form screens", () => {
  // cites: REQ-006/AC-001
  it("shows New dish on the dish list, but not on the deleted list", () => {
    expect(render(listScreen("selectable"))).toContain('data-testid="new-dish"');
    expect(render(listScreen("deleted"))).not.toContain('data-testid="new-dish"');
  });

  // cites: REQ-006/AC-009
  it("shows Edit on the view of a selectable dish only", () => {
    expect(render({ name: "dish", dish: DISH, confirmDelete: false })).toContain('data-testid="edit-dish"');
    const gone = { ...DISH, selectable: false };
    expect(render({ name: "dish", dish: gone, confirmDelete: false })).not.toContain('data-testid="edit-dish"');
  });

  // cites: REQ-006/AC-001
  it("shows an empty form with a name, a line, the picker and add line", () => {
    const html = render(formScreen());
    expect(html).toContain('data-testid="dish-form"');
    expect(html).toContain('data-testid="dish-name"');
    expect(html).toContain('data-testid="line-product-0"');
    expect(html).toContain('data-testid="add-line"');
    expect(html).toContain("egg white (corner)");
  });

  // cites: REQ-006/AC-003
  it("disables pieces for a product with no piece weight and allows it for one with", () => {
    const line = (productId: string) => ({ name: "x", lines: [{ productId, amount: "2", unit: "grams" as const }] });
    expect(render(formScreen({ values: line("p-1") }))).toMatch(/<option value="pieces"[^>]*disabled/);
    expect(render(formScreen({ values: line("p-2") }))).not.toMatch(/<option value="pieces"[^>]*disabled/);
  });

  // cites: REQ-006/AC-001
  it("shows an amount with a comma decimal as typed", () => {
    const values = { name: "x", lines: [{ productId: "p-1", amount: "100,5", unit: "grams" as const }] };
    expect(render(formScreen({ values }))).toContain('value="100,5"');
  });

  // cites: REQ-006/AC-009
  it("prefills the edit form from the dish", () => {
    const html = render(formScreen({ original: DISH, values: dishToForm(DISH) }));
    expect(html).toContain("Edit dish");
    expect(html).toContain('value="omelette"');
    expect(html).toContain('data-testid="line-amount-1"');
  });

  // cites: REQ-006/AC-009
  it("shows the new-dish notice on the dish after a 201 edit", () => {
    const html = render({ name: "dish", dish: DISH, confirmDelete: false, notice: DISH_SAVED_NEW_TEXT });
    expect(html).toContain(DISH_SAVED_NEW_TEXT);
  });

  // cites: REQ-006/AC-013
  it("marks the lines when a dish has a name and no products", () => {
    const errors = { ...emptyErrors(), lines: LINES_REQUIRED_TEXT };
    expect(render(formScreen({ errors }))).toContain('data-testid="dish-lines-error"');
  });

  // cites: REQ-006/AC-014
  it("marks the name when a dish has products and no name", () => {
    const errors = { ...emptyErrors(), name: NAME_REQUIRED_TEXT };
    const html = render(formScreen({ errors }));
    expect(html).toContain('data-testid="dish-name-error"');
    expect(html).toContain(NAME_REQUIRED_TEXT);
  });

  // cites: REQ-006/AC-003
  it("marks only the refused line with its reason", () => {
    const values = {
      name: "x",
      lines: [
        { productId: "p-2", amount: "1", unit: "pieces" as const },
        { productId: "p-1", amount: "2", unit: "pieces" as const },
      ],
    };
    const errors = { ...emptyErrors(), line: { 1: LINE_NO_PIECE_WEIGHT_TEXT } };
    const html = render(formScreen({ values, errors }));
    expect(html).toContain('data-testid="line-error-1"');
    expect(html).not.toContain('data-testid="line-error-0"');
  });

  // cites: REQ-006/AC-017
  it("shows no duplicate-name warning in the form", () => {
    const html = render(formScreen({ values: { name: "omelette", lines: dishToForm(DISH).lines } }));
    expect(html).not.toContain("already exists");
    expect(html).not.toContain("duplicate");
  });
});
