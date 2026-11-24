// Dishes (REQ-006, IF-001@1.3.0): the dish screens' pure logic, no browser needed.

import type { Dish, DishChangeResult, DishLine, DishListResult, DishState } from "./dishApi";
import { formatNumber } from "./edit";

export type DishScreen =
  | { name: "dishes_busy" }
  | { name: "dishes"; view: DishState; dishes: Dish[]; filter: string; notice: string | null }
  | { name: "dish"; dish: Dish; confirmDelete: boolean };

export type DishNext =
  | { kind: "screen"; screen: DishScreen }
  | { kind: "login" }
  | { kind: "failed"; message: string };

export type DishOutcome =
  | DishNext
  | { kind: "reload"; view: DishState; notice: string }
  | { kind: "keep"; notice: string };

export const DISH_LIST_FAILED_TEXT = "The dishes could not be loaded. Try again.";
export const DISH_CHANGE_FAILED_TEXT = "That did not work. Try again.";
export const DISH_CHANGED_TEXT = "The dish changed meanwhile. The list was reloaded.";
export const DISH_DELETED_TEXT = "Dish deleted.";
export const DISH_RESTORED_TEXT = "Dish restored.";
export const UNSELECTABLE_PRODUCT_TEXT = "Product replaced or deleted";

// A simple text filter on the dish name. Dishes with the same name are all kept.
export function filterDishes(dishes: Dish[], filter: string): Dish[] {
  const q = filter.trim().toLowerCase();
  if (q === "") return dishes;
  return dishes.filter((d) => d.name.toLowerCase().includes(q));
}

export function nextAfterDishList(result: DishListResult, view: DishState, notice: string | null): DishNext {
  switch (result.kind) {
    case "ok":
      return { kind: "screen", screen: { name: "dishes", view, dishes: result.dishes, filter: "", notice } };
    case "unauthorized":
      return { kind: "login" };
    case "failed":
      return { kind: "failed", message: result.message ?? DISH_LIST_FAILED_TEXT };
  }
}

// After deleteDish: back to the selectable list, where the dish no longer appears.
export function deleteDishOutcome(result: DishChangeResult): DishOutcome {
  switch (result.kind) {
    case "ok":
      return { kind: "reload", view: "selectable", notice: DISH_DELETED_TEXT };
    case "not_selectable":
    case "not_found":
      return { kind: "reload", view: "selectable", notice: DISH_CHANGED_TEXT };
    case "unauthorized":
      return { kind: "login" };
    case "failed":
      return { kind: "failed", message: result.message ?? DISH_CHANGE_FAILED_TEXT };
  }
}

// After restoreDish: the deleted list is reloaded; a failure keeps the list and says so.
export function restoreDishOutcome(result: DishChangeResult): DishOutcome {
  switch (result.kind) {
    case "ok":
      return { kind: "reload", view: "deleted", notice: DISH_RESTORED_TEXT };
    case "not_selectable":
    case "not_found":
      return { kind: "reload", view: "deleted", notice: DISH_CHANGED_TEXT };
    case "unauthorized":
      return { kind: "login" };
    case "failed":
      return { kind: "keep", notice: result.message ?? DISH_CHANGE_FAILED_TEXT };
  }
}

// The amount as saved, then the line weight the server computed.
export function lineText(line: DishLine): string {
  let amount = "";
  if (line.grams !== null) amount = `${formatNumber(line.grams)} g`;
  else if (line.pieces !== null) amount = `${formatNumber(line.pieces)} ${line.pieces === 1 ? "piece" : "pieces"}`;
  return `${line.product.name}: ${amount} (${formatNumber(line.weight_grams)} g)`;
}

// A line is marked when its exact product was replaced or deleted (R-009).
export function lineIsMarked(line: DishLine): boolean {
  return line.product.selectable === false || line.product.deleted === true;
}
