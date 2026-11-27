import type { DayCloser, DayRange } from "./day-close.js";
import type { DishStore } from "./dish-store.js";
import { MEALS, type EntryKind, type Meal, type PlanStore, type StoredEntry } from "./plan-store.js";
import type { ProductStore } from "./products.js";
import { TARGET_NUTRIENTS, type TargetNutrient, type TargetStore } from "./target-store.js";
import { rangesInForce } from "./targets.js";

/** What the totals function reads (ADR-019/C-003). Only CMP-002 reaches the stores. */
export interface TotalsDeps {
  plans: PlanStore;
  products: ProductStore;
  dishes: DishStore;
  targets: TargetStore;
  /** Reads the ranges stored at closing. Absent: a closed day has no ranges to read. */
  closer?: DayCloser;
}

/** Unrounded values of the three nutrients. */
export type Values = Record<TargetNutrient, number>;

export interface MealTotals {
  calories: number;
  protein: number;
  fat: number;
}

export type Status = "green" | "yellow" | "red" | "no_range";

export interface NutrientResult {
  nutrient: TargetNutrient;
  unit: "kcal" | "g";
  total: number;
  minimum: number | null;
  maximum: number | null;
  status: Status;
  signed_number: string | null;
}

export interface DayResult {
  ranges_source: "in_force" | "closed_copy";
  nutrients: NutrientResult[];
}

const UNITS: Record<TargetNutrient, "kcal" | "g"> = { calories: "kcal", protein: "g", fat: "g" };

const zero = (): Values => ({ calories: 0, protein: 0, fat: 0 });

/**
 * One rounding function (ADR-021/C-001, A-043): normalise the unrounded sum to 6 decimals, then Math.round once.
 * Totals are never negative, so halves go up: 99.5 gives 100.
 */
export function roundTotal(unrounded: number): number {
  return Math.round(Number(unrounded.toFixed(6)));
}

/** The signed number of a rounded total against a range (R-012, ADR-021/C-002). */
function signedNumber(total: number, minimum: number, maximum: number): string {
  if (total < minimum) return `-${minimum - total}`;
  if (total > maximum) return `+${total - maximum}`;
  if (total === maximum) return "0";
  return `-${maximum - total}`;
}

/**
 * One comparison function for plan and log, open and closed days (ADR-021/C-001, REQ-010/AC-023). The status and the
 * signed number come from the rounded total only (REQ-010/AC-025). No range gives no_range and a null number (A-045).
 */
export function compareToRange(
  nutrient: TargetNutrient,
  unrounded: number,
  range: { minimum: number; maximum: number } | undefined,
): NutrientResult {
  const total = roundTotal(unrounded);
  const base = { nutrient, unit: UNITS[nutrient], total };
  if (!range) return { ...base, minimum: null, maximum: null, status: "no_range", signed_number: null };
  const status: Status = total < range.minimum ? "yellow" : total > range.maximum ? "red" : "green";
  return {
    ...base,
    minimum: range.minimum,
    maximum: range.maximum,
    status,
    signed_number: signedNumber(total, range.minimum, range.maximum),
  };
}

/** The unrounded values of one amount of a product, by the exact product id (R-004): per-100 g value times grams, over 100. */
async function productValues(
  deps: TotalsDeps,
  productId: string,
  grams: number | null,
  pieces: number | null,
): Promise<Values> {
  const found = await deps.products.get(productId);
  if (!found) throw new Error("an entry names a product that does not exist");
  const weight = grams ?? (pieces ?? 0) * (found.product.piece_weight ?? 0);
  const { calories, protein, fat } = found.product;
  return { calories: (calories * weight) / 100, protein: (protein * weight) / 100, fat: (fat * weight) / 100 };
}

function add(a: Values, b: Values): Values {
  return { calories: a.calories + b.calories, protein: a.protein + b.protein, fat: a.fat + b.fat };
}

export function sumValues(list: readonly Values[]): Values {
  return list.reduce(add, zero());
}

/** The unrounded values of one entry: a product entry by its amount, a dish entry by the sum of its dish lines. */
export async function entryValues(deps: TotalsDeps, entry: StoredEntry): Promise<Values> {
  if (entry.product_id !== null) return productValues(deps, entry.product_id, entry.grams, entry.pieces);
  if (entry.dish_id !== null) {
    const found = await deps.dishes.get(entry.dish_id);
    if (!found) throw new Error("an entry names a dish that does not exist");
    const lines: Values[] = [];
    for (const line of found.dish.lines) lines.push(await productValues(deps, line.product_id, line.grams, line.pieces));
    return sumValues(lines);
  }
  return zero();
}

/** The unrounded totals of some entries. Never stored (ADR-019/C-003). */
export async function totalsOfEntries(deps: TotalsDeps, entries: readonly StoredEntry[]): Promise<Values> {
  const values: Values[] = [];
  for (const entry of entries) values.push(await entryValues(deps, entry));
  return sumValues(values);
}

/**
 * The one totals function (ADR-019/C-003): the unrounded totals of a kind (plan or log), a day and optionally a meal.
 * A log total never includes the plan (REQ-010/AC-007).
 */
export async function computeTotals(deps: TotalsDeps, kind: EntryKind, day: string, meal?: Meal): Promise<Values> {
  const read = await deps.plans.read(day, kind);
  return totalsOfEntries(deps, meal ? read.entries.filter((e) => e.meal === meal) : read.entries);
}

/**
 * The ranges that apply to a day. A closed day uses only its stored rows, never target_ranges (ADR-015/C-004,
 * REQ-010/AC-014). An open day uses the ranges in force on its date.
 */
export async function rangesForDay(
  deps: TotalsDeps,
  date: string,
  closed: boolean,
): Promise<{ source: DayResult["ranges_source"]; ranges: DayRange[] }> {
  if (closed) return { source: "closed_copy", ranges: deps.closer ? await deps.closer.closedRanges(date) : [] };
  const found = await rangesInForce(deps.targets, date);
  const ranges: DayRange[] = [];
  for (const nutrient of TARGET_NUTRIENTS) {
    const range = found[nutrient];
    if (range) ranges.push({ nutrient, minimum: range.minimum, maximum: range.maximum });
  }
  return { source: "in_force", ranges };
}

/** The result of a day total against the ranges, calories, protein and fat in that order. */
export function buildResult(totals: Values, source: DayResult["ranges_source"], ranges: readonly DayRange[]): DayResult {
  return {
    ranges_source: source,
    nutrients: TARGET_NUTRIENTS.map((nutrient) =>
      compareToRange(nutrient, totals[nutrient], ranges.find((r) => r.nutrient === nutrient)),
    ),
  };
}

/** Whole-number totals of one meal, with no range, colour or comparison (ADR-021/C-003). */
export function toMealTotals(values: Values): MealTotals {
  return { calories: roundTotal(values.calories), protein: roundTotal(values.protein), fat: roundTotal(values.fat) };
}

/**
 * The totals of a sheet already read: each meal's totals and the day result. Each entry is valued once, and the
 * day total sums the unrounded entry values, never the rounded meal totals.
 */
export async function buildSheetParts(
  deps: TotalsDeps,
  date: string,
  entries: readonly StoredEntry[],
  closed: boolean,
): Promise<{ meals: Record<Meal, MealTotals>; result: DayResult }> {
  const valued: { meal: Meal; values: Values }[] = [];
  for (const entry of entries) valued.push({ meal: entry.meal, values: await entryValues(deps, entry) });
  const meals = {} as Record<Meal, MealTotals>;
  for (const meal of MEALS) {
    meals[meal] = toMealTotals(sumValues(valued.filter((v) => v.meal === meal).map((v) => v.values)));
  }
  const { source, ranges } = await rangesForDay(deps, date, closed);
  return { meals, result: buildResult(sumValues(valued.map((v) => v.values)), source, ranges) };
}
