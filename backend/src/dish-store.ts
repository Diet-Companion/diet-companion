import type { ListState } from "./products.js";

/** Version and soft-delete state of a dish row (ADR-012). Selectable when both are null. */
export interface DishState {
  replaced_by: string | null;
  deleted_at: Date | null;
}

/** One line as saved: a product id and exactly one amount (R-007, A-023). */
export interface NewDishLine {
  product_id: string;
  grams: number | null;
  pieces: number | null;
}

export interface DishLine extends NewDishLine {
  /** Zero-based display order. */
  position: number;
}

export interface NewDish {
  name: string;
  lines: NewDishLine[];
}

export interface Dish {
  id: string;
  name: string;
  lines: DishLine[];
}

/** A dish with its state: what getDish and listDishes read (ADR-012/C-003). */
export interface DishRecord {
  dish: Dish;
  state: DishState;
}

/** The one predicate that decides selectable (ADR-012/C-003): neither replaced nor soft-deleted. */
export function isDishSelectable(state: DishState): boolean {
  return state.replaced_by === null && state.deleted_at === null;
}

/** The dish was replaced by a newer version (IF-001@1.3.0 dish.not_selectable). */
export class DishNotSelectableError extends Error {}

/** Storage seam for dishes. Only CMP-002 reaches the database (ADR-003/C-002). */
export interface DishStore {
  /**
   * Saves a dish and its lines in one transaction, at the given creation time. The caller has already checked the
   * lines (R-007, ADR-014/C-001). Duplicate names are allowed (R-010). Nothing is saved on a throw.
   */
  add(dish: NewDish, at: Date): Promise<DishRecord>;
  /** Any dish by id, in any state (ADR-012/C-003). */
  get(id: string): Promise<DishRecord | undefined>;
  /** Selectable or soft-deleted dishes, ordered by name ignoring letter case, then id. Replaced versions never appear. */
  listByState(state: ListState): Promise<DishRecord[]>;
  /**
   * Soft delete (R-010), deleted_at = at. Already deleted: returned unchanged. Undefined when the id is unknown.
   * Throws DishNotSelectableError when the dish was replaced.
   */
  softDelete(id: string, at: Date): Promise<DishRecord | undefined>;
  /**
   * Clears deleted_at, lines unchanged (R-010). Already selectable: returned unchanged. Undefined when the id is
   * unknown. Throws DishNotSelectableError when the dish was replaced.
   */
  restore(id: string): Promise<DishRecord | undefined>;
}
