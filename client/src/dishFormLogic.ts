// Create and edit a dish (REQ-006, IF-001@1.3.0 createDish, editDish): the form values, the checks before
// sending, the body to send, and what follows each answer. Pure logic, no browser needed.

import type { Product } from "./api";
import type { Dish, DishLineInput, DishUpdate, DishWriteResult, NewDishInput } from "./dishApi";
import { DISH_CHANGED_TEXT, DISH_CHANGE_FAILED_TEXT, UNSELECTABLE_PRODUCT_TEXT } from "./dishes";
import { formatNumber } from "./edit";
import { parseDecimal } from "./flow";

export const DISH_CREATED_TEXT = "Dish saved.";
export const DISH_SAVED_NEW_TEXT = "Saved as a new dish; the old one is kept for past days";
export const DISH_SAVED_TEXT = "Saved";
export const NAME_REQUIRED_TEXT = "Enter a name for the dish";
export const LINES_REQUIRED_TEXT = "Add at least one product";
export const LINE_PRODUCT_TEXT = "Pick a product";
export const LINE_AMOUNT_TEXT = "Enter an amount above 0";
export const LINE_NO_PIECE_WEIGHT_TEXT = "This product has no piece weight; give it in grams";
export const LINE_NOT_FOUND_TEXT = "Product not found";

export type AmountUnit = "grams" | "pieces";

export interface LineValues {
  productId: string;
  amount: string;
  unit: AmountUnit;
}

export interface DishFormValues {
  name: string;
  lines: LineValues[];
}

// line is keyed by the index of the line in the form.
export interface FormErrors {
  name: string | null;
  lines: string | null;
  line: Record<number, string>;
}

export type ProductChoice = Pick<Product, "id" | "piece_weight">;

export function emptyErrors(): FormErrors {
  return { name: null, lines: null, line: {} };
}

export function blankLine(): LineValues {
  return { productId: "", amount: "", unit: "grams" };
}

export function emptyForm(): DishFormValues {
  return { name: "", lines: [blankLine()] };
}

export function addLine(values: DishFormValues): DishFormValues {
  return { ...values, lines: [...values.lines, blankLine()] };
}

export function removeLine(values: DishFormValues, index: number): DishFormValues {
  return { ...values, lines: values.lines.filter((_, i) => i !== index) };
}

// The form values for a dish: its own lines, numbers with a comma decimal.
export function dishToForm(dish: Dish): DishFormValues {
  return {
    name: dish.name,
    lines: dish.lines.map((l) =>
      l.grams !== null
        ? { productId: l.product.id, amount: formatNumber(l.grams), unit: "grams" as const }
        : { productId: l.product.id, amount: formatNumber(l.pieces ?? 0), unit: "pieces" as const },
    ),
  };
}

function lineInput(productId: string, unit: AmountUnit, n: number): DishLineInput {
  return unit === "grams" ? { product_id: productId, grams: n } : { product_id: productId, pieces: n };
}

function isBlank(l: LineValues): boolean {
  return l.productId === "" && l.amount.trim() === "";
}

// The text for a reason the server gave for a refused line.
export function reasonText(reason: string): string {
  switch (reason) {
    case "product_not_found":
      return LINE_NOT_FOUND_TEXT;
    case "product_not_selectable":
      return UNSELECTABLE_PRODUCT_TEXT;
    case "piece_without_weight":
      return LINE_NO_PIECE_WEIGHT_TEXT;
    default:
      return LINE_AMOUNT_TEXT;
  }
}

type FormRead =
  | { ok: true; name: string; lines: DishLineInput[]; sent: number[] }
  | { ok: false; errors: FormErrors };

// Blank lines are skipped. sent[k] is the form index of the k-th line in the request.
export function readForm(values: DishFormValues, products: readonly ProductChoice[]): FormRead {
  const errors = emptyErrors();
  const name = values.name.trim();
  if (name === "") errors.name = NAME_REQUIRED_TEXT;
  const lines: DishLineInput[] = [];
  const sent: number[] = [];
  let filled = 0;
  values.lines.forEach((l, i) => {
    if (isBlank(l)) return;
    filled += 1;
    const known = products.find((p) => p.id === l.productId);
    const n = parseDecimal(l.amount);
    if (l.productId === "") errors.line[i] = LINE_PRODUCT_TEXT;
    else if (n === null || n <= 0) errors.line[i] = LINE_AMOUNT_TEXT;
    else if (l.unit === "pieces" && known !== undefined && known.piece_weight === undefined) {
      errors.line[i] = LINE_NO_PIECE_WEIGHT_TEXT;
    } else {
      lines.push(lineInput(l.productId, l.unit, n));
      sent.push(i);
    }
  });
  if (filled === 0) errors.lines = LINES_REQUIRED_TEXT;
  if (errors.name !== null || errors.lines !== null || Object.keys(errors.line).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, name, lines, sent };
}

export type CreateBuild =
  | { ok: true; input: NewDishInput; sent: number[] }
  | { ok: false; errors: FormErrors };

// Names are never compared with other dishes: duplicates are allowed (R-010).
export function buildCreate(values: DishFormValues, products: readonly ProductChoice[]): CreateBuild {
  const r = readForm(values, products);
  if (!r.ok) return r;
  return { ok: true, input: { name: r.name, lines: r.lines }, sent: r.sent };
}

export type EditBuild =
  | { ok: true; update: DishUpdate | null; sent: number[] }
  | { ok: false; errors: FormErrors };

// Only what changed. A changed line list is sent whole. null means nothing changed, so nothing is sent.
export function buildEdit(original: Dish, values: DishFormValues, products: readonly ProductChoice[]): EditBuild {
  const r = readForm(values, products);
  if (!r.ok) return r;
  const update: DishUpdate = {};
  if (r.name !== original.name) update.name = r.name;
  const before = dishToForm(original).lines.map((l) => lineInput(l.productId, l.unit, parseDecimal(l.amount) ?? 0));
  if (JSON.stringify(before) !== JSON.stringify(r.lines)) update.lines = r.lines;
  return { ok: true, update: Object.keys(update).length > 0 ? update : null, sent: r.sent };
}

export type DishFormOutcome =
  | { kind: "reload"; notice: string }
  | { kind: "dish"; dish: Dish; notice: string }
  | { kind: "stay"; errors: FormErrors; notice: string | null }
  | { kind: "login" };

// What follows createDish or editDish. The form stays filled on a refusal the Owner can fix.
export function writeOutcome(result: DishWriteResult, sent: readonly number[], isEdit: boolean): DishFormOutcome {
  const stay = (errors: FormErrors, notice: string | null): DishFormOutcome => ({ kind: "stay", errors, notice });
  switch (result.kind) {
    case "ok":
      if (!isEdit) return { kind: "reload", notice: DISH_CREATED_TEXT };
      return { kind: "dish", dish: result.dish, notice: result.versioned ? DISH_SAVED_NEW_TEXT : DISH_SAVED_TEXT };
    case "line_invalid": {
      const errors = emptyErrors();
      for (const r of result.lines) errors.line[sent[r.index] ?? r.index] = reasonText(r.reason);
      return stay(errors, result.lines.length > 0 ? null : (result.message ?? DISH_CHANGE_FAILED_TEXT));
    }
    case "values_missing": {
      const errors = emptyErrors();
      if (result.missing.includes("name")) errors.name = NAME_REQUIRED_TEXT;
      if (result.missing.includes("lines")) errors.lines = LINES_REQUIRED_TEXT;
      return stay(errors, result.missing.length > 0 ? null : (result.message ?? DISH_CHANGE_FAILED_TEXT));
    }
    case "not_selectable":
    case "not_found":
      return isEdit ? { kind: "reload", notice: DISH_CHANGED_TEXT } : stay(emptyErrors(), DISH_CHANGE_FAILED_TEXT);
    case "unauthorized":
      return { kind: "login" };
    case "failed":
      return stay(emptyErrors(), result.message ?? DISH_CHANGE_FAILED_TEXT);
  }
}
