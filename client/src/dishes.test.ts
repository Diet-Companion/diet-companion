import { describe, expect, it } from "vitest";
import type { Dish, DishLine } from "./dishApi";
import {
  DISH_CHANGED_TEXT,
  deleteDishOutcome,
  filterDishes,
  lineIsMarked,
  lineText,
  nextAfterDishList,
  restoreDishOutcome,
} from "./dishes";

const DISH: Dish = {
  id: "d-1",
  name: "omelette",
  lines: [],
  total_weight_grams: 200,
  replaced_by: null,
  deleted: false,
  selectable: true,
  has_unselectable_product: false,
};

const EGGS: DishLine = {
  position: 1,
  product: { id: "p-2", name: "egg" },
  grams: null,
  pieces: 2,
  weight_grams: 100,
};

describe("dish flow", () => {
  // cites: REQ-006/AC-002
  it("shows 2 eggs as pieces with the 100 g line weight", () => {
    const t = lineText(EGGS);
    expect(t).toContain("2 pieces");
    expect(t).toContain("100 g");
  });

  // cites: REQ-006/AC-018
  it("shows the product name it was given and a comma decimal for grams", () => {
    const t = lineText({ ...EGGS, product: { id: "p-2", name: "Product B" }, grams: 12.5, pieces: null });
    expect(t).toContain("Product B");
    expect(t).toContain("12,5 g");
  });

  // cites: R-009
  it("marks a line whose product was replaced or deleted, and no other", () => {
    expect(lineIsMarked({ ...EGGS, product: { id: "p-2", name: "egg", selectable: false } })).toBe(true);
    expect(lineIsMarked({ ...EGGS, product: { id: "p-2", name: "egg", deleted: true } })).toBe(true);
    expect(lineIsMarked(EGGS)).toBe(false);
  });

  // cites: REQ-006/AC-017
  it("filters by name and keeps two dishes with the same name", () => {
    const list = [DISH, { ...DISH, id: "d-2" }, { ...DISH, id: "d-3", name: "salad" }];
    expect(filterDishes(list, "OMEL").map((d) => d.id)).toEqual(["d-1", "d-2"]);
    expect(filterDishes(list, "  ")).toHaveLength(3);
  });

  // cites: REQ-006/AC-011
  it("returns to the selectable list after a delete and on a changed dish", () => {
    expect(deleteDishOutcome({ kind: "ok", dish: DISH })).toMatchObject({ kind: "reload", view: "selectable" });
    expect(deleteDishOutcome({ kind: "not_found" })).toEqual({
      kind: "reload",
      view: "selectable",
      notice: DISH_CHANGED_TEXT,
    });
    expect(deleteDishOutcome({ kind: "unauthorized" })).toEqual({ kind: "login" });
  });

  // cites: REQ-006/AC-016
  it("reloads the deleted list after a restore and keeps it on a failure", () => {
    expect(restoreDishOutcome({ kind: "ok", dish: DISH })).toMatchObject({ kind: "reload", view: "deleted" });
    expect(restoreDishOutcome({ kind: "failed", message: null }).kind).toBe("keep");
  });

  // cites: REQ-006/AC-012
  it("opens the list screen with the dishes it was given and sends 401 to login", () => {
    const next = nextAfterDishList({ kind: "ok", dishes: [DISH] }, "selectable", null);
    expect(next).toMatchObject({ kind: "screen", screen: { name: "dishes", view: "selectable" } });
    expect(nextAfterDishList({ kind: "unauthorized" }, "selectable", null)).toEqual({ kind: "login" });
  });
});
