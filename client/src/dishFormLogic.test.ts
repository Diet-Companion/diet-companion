import { describe, expect, it } from "vitest";
import type { Dish } from "./dishApi";
import {
  DISH_SAVED_NEW_TEXT,
  DISH_SAVED_TEXT,
  LINES_REQUIRED_TEXT,
  LINE_NO_PIECE_WEIGHT_TEXT,
  NAME_REQUIRED_TEXT,
  addLine,
  buildCreate,
  buildEdit,
  dishToForm,
  emptyForm,
  removeLine,
  writeOutcome,
  type DishFormValues,
} from "./dishFormLogic";
import { DISH_CHANGED_TEXT } from "./dishes";

const PRODUCTS = [{ id: "p-1" }, { id: "p-2", piece_weight: 50 }];

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

const FORM: DishFormValues = {
  name: "omelette",
  lines: [
    { productId: "p-1", amount: "100", unit: "grams" },
    { productId: "p-2", amount: "2", unit: "pieces" },
  ],
};

describe("dish form: create", () => {
  // cites: REQ-006/AC-001, IF-001@1.3.0#createDish
  it("builds the create body with grams, pieces and comma decimals", () => {
    const form: DishFormValues = {
      name: " omelette ",
      lines: [
        { productId: "p-1", amount: "100,5", unit: "grams" },
        { productId: "p-2", amount: "2", unit: "pieces" },
        { productId: "", amount: "", unit: "grams" },
      ],
    };
    const r = buildCreate(form, PRODUCTS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input).toEqual({
        name: "omelette",
        lines: [
          { product_id: "p-1", grams: 100.5 },
          { product_id: "p-2", pieces: 2 },
        ],
      });
      expect(r.sent).toEqual([0, 1]);
    }
  });

  // cites: REQ-006/AC-003
  it("refuses pieces for a product with no piece weight", () => {
    const form: DishFormValues = { name: "x", lines: [{ productId: "p-1", amount: "2", unit: "pieces" }] };
    const r = buildCreate(form, PRODUCTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.line[0]).toBe(LINE_NO_PIECE_WEIGHT_TEXT);
  });

  // cites: REQ-006/AC-013
  it("does not build a dish with a name and no products", () => {
    const r = buildCreate({ name: "omelette", lines: [{ productId: "", amount: "", unit: "grams" }] }, PRODUCTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lines).toBe(LINES_REQUIRED_TEXT);
  });

  // cites: REQ-006/AC-014
  it("does not build a dish with a product and no name", () => {
    const r = buildCreate({ name: "  ", lines: FORM.lines }, PRODUCTS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toBe(NAME_REQUIRED_TEXT);
  });

  // cites: REQ-006/AC-017
  it("builds a dish with a name another dish already has, with no warning", () => {
    const r = buildCreate(FORM, PRODUCTS);
    expect(r.ok).toBe(true);
  });

  // cites: REQ-006/AC-001
  it("adds and removes lines", () => {
    const added = addLine(emptyForm());
    expect(added.lines).toHaveLength(2);
    expect(removeLine(added, 0).lines).toHaveLength(1);
  });
});

describe("dish form: edit", () => {
  // cites: REQ-006/AC-009
  it("prefills the form from the dish", () => {
    expect(dishToForm(DISH)).toEqual(FORM);
  });

  // cites: REQ-006/AC-009, IF-001@1.3.0#editDish
  it("sends nothing when nothing changed", () => {
    const r = buildEdit(DISH, FORM, PRODUCTS);
    expect(r.ok && r.update).toBeNull();
  });

  // cites: REQ-006/AC-009, IF-001@1.3.0#editDish
  it("sends only the name for a name-only change", () => {
    const r = buildEdit(DISH, { ...FORM, name: "big omelette" }, PRODUCTS);
    expect(r.ok && r.update).toEqual({ name: "big omelette" });
  });

  // cites: REQ-006/AC-009, IF-001@1.3.0#editDish
  it("sends the complete lines list when an amount changed", () => {
    const form: DishFormValues = {
      ...FORM,
      lines: [{ productId: "p-1", amount: "150", unit: "grams" }, ...FORM.lines.slice(1)],
    };
    const r = buildEdit(DISH, form, PRODUCTS);
    expect(r.ok && r.update).toEqual({
      lines: [
        { product_id: "p-1", grams: 150 },
        { product_id: "p-2", pieces: 2 },
      ],
    });
  });
});

describe("dish form: outcomes", () => {
  // cites: REQ-006/AC-009
  it("says a new dish was saved after a 201 edit", () => {
    const o = writeOutcome({ kind: "ok", dish: DISH, versioned: true }, [0, 1], true);
    expect(o).toEqual({ kind: "dish", dish: DISH, notice: DISH_SAVED_NEW_TEXT });
  });

  // cites: REQ-006/AC-009, IF-001@1.3.0#editDish
  it("says Saved after a 200 name-only edit", () => {
    const o = writeOutcome({ kind: "ok", dish: DISH, versioned: false }, [], true);
    expect(o).toEqual({ kind: "dish", dish: DISH, notice: DISH_SAVED_TEXT });
  });

  // cites: REQ-006/AC-009, IF-001@1.3.0#editDish
  it("reloads the list when the dish changed meanwhile, and goes to login on 401", () => {
    const changed = { kind: "reload", notice: DISH_CHANGED_TEXT };
    expect(writeOutcome({ kind: "not_selectable", message: null }, [], true)).toEqual(changed);
    expect(writeOutcome({ kind: "not_found" }, [], true)).toEqual(changed);
    expect(writeOutcome({ kind: "unauthorized" }, [], true)).toEqual({ kind: "login" });
  });

  // cites: REQ-006/AC-003, IF-001@1.3.0#createDish
  it("marks each refused line by its form index with its reason", () => {
    const result = {
      kind: "line_invalid",
      lines: [{ index: 1, reason: "piece_without_weight" }],
      message: null,
    } as const;
    const o = writeOutcome(result, [0, 2], false);
    expect(o.kind === "stay" && o.errors.line[2]).toBe(LINE_NO_PIECE_WEIGHT_TEXT);
  });

  // cites: REQ-006/AC-013, REQ-006/AC-014, IF-001@1.3.0#createDish
  it("marks the name and the lines the server says are missing", () => {
    const result = { kind: "values_missing", missing: ["name", "lines"], message: null } as const;
    const o = writeOutcome(result, [], false);
    expect(o.kind === "stay" && [o.errors.name, o.errors.lines]).toEqual([NAME_REQUIRED_TEXT, LINES_REQUIRED_TEXT]);
  });
});
