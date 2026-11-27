// IF-001@1.6.0 plan operations (REQ-013): getDayPlan, addPlanEntry, changePlanEntry, removePlanEntry.
// Fetch and run id are injected. Types follow architecture/system/interfaces/IF-001/openapi-1.6.0.json.

import type { FetchLike } from "./api";

export const MEALS = ["breakfast", "brunch", "lunch", "afternoon_snack", "dinner"] as const;
export type Meal = (typeof MEALS)[number];

/** The product or dish of an entry, with the marks the response carries. */
export interface PlanSubject {
  id: string;
  name: string;
  deleted: boolean;
  replaced: boolean;
}

export interface PlanEntry {
  id: string;
  meal: Meal;
  product: PlanSubject | null;
  dish: PlanSubject | null;
  grams: number | null;
  pieces: number | null;
}

/** Whole-number totals of one meal, as the server sends them (ADR-021). Never computed in the client. */
export interface MealTotals {
  calories: number;
  protein: number;
  fat: number;
}

export type NutrientStatus = "green" | "yellow" | "red" | "no_range";

/** One nutrient of a day result (IF-001 NutrientResult), shown as given (ADR-021). */
export interface NutrientResult {
  nutrient: "calories" | "protein" | "fat";
  unit: "kcal" | "g";
  total: number;
  minimum: number | null;
  maximum: number | null;
  status: NutrientStatus;
  signed_number: string | null;
}

/** The day result of IF-001 (DayResult). Named DaySheetResult here: DayResult is the outcome of getDayPlan. */
export interface DaySheetResult {
  ranges_source: "in_force" | "closed_copy";
  nutrients: NutrientResult[];
}

export interface MealSheet {
  meal: Meal;
  entries: PlanEntry[];
  /** Present when the server sent it. */
  totals?: MealTotals;
}

export interface DaySheet {
  date: string;
  today: string;
  closed: boolean;
  editable: boolean;
  meals: MealSheet[];
  /** Present when the server sent it. */
  result?: DaySheetResult;
}

export interface NewEntryInput {
  meal: Meal;
  product_id?: string;
  dish_id?: string;
  grams?: number;
  pieces?: number;
}

export interface AmountInput {
  grams?: number;
  pieces?: number;
}

/** A refusal by the server: its code (entry.invalid, day.closed, plan.day_out_of_range, ...) and reasons. */
export interface PlanError {
  code: string;
  reasons: string[];
  message: string | null;
}

export type DayResult =
  | { kind: "ok"; sheet: DaySheet }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string | null };

export type EntryResult =
  | { kind: "ok"; entry: PlanEntry }
  | { kind: "refused"; error: PlanError }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string | null };

export type RemoveResult =
  | { kind: "ok" }
  | { kind: "refused"; error: PlanError }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string | null };

export interface PlanApi {
  getDayPlan(date: string): Promise<DayResult>;
  addPlanEntry(date: string, input: NewEntryInput): Promise<EntryResult>;
  changePlanEntry(date: string, entryId: string, amount: AmountInput): Promise<EntryResult>;
  removePlanEntry(date: string, entryId: string): Promise<RemoveResult>;
}

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function isMeal(x: unknown): x is Meal {
  return typeof x === "string" && (MEALS as readonly string[]).includes(x);
}

// null is no subject; undefined is a body that is not one.
function parseSubject(raw: unknown): PlanSubject | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return undefined;
  return { id: raw.id, name: raw.name, deleted: raw.deleted === true, replaced: typeof raw.replaced_by === "string" };
}

function amountOf(x: unknown): number | null {
  return typeof x === "number" ? x : null;
}

export function parseEntry(raw: unknown): PlanEntry | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !isMeal(raw.meal)) return null;
  const product = parseSubject(raw.product);
  const dish = parseSubject(raw.dish);
  if (product === undefined || dish === undefined) return null;
  return { id: raw.id, meal: raw.meal, product, dish, grams: amountOf(raw.grams), pieces: amountOf(raw.pieces) };
}

const STATUSES: readonly string[] = ["green", "yellow", "red", "no_range"];
const NUTRIENTS: readonly string[] = ["calories", "protein", "fat"];

function numberOrNull(x: unknown): number | null | undefined {
  if (x === null) return null;
  return typeof x === "number" ? x : undefined;
}

function parseNutrient(raw: unknown): NutrientResult | null {
  if (!isRecord(raw)) return null;
  const { nutrient, unit, total, status, signed_number: signed } = raw;
  if (typeof nutrient !== "string" || !NUTRIENTS.includes(nutrient)) return null;
  if (unit !== "kcal" && unit !== "g") return null;
  if (typeof total !== "number" || typeof status !== "string" || !STATUSES.includes(status)) return null;
  const minimum = numberOrNull(raw.minimum);
  const maximum = numberOrNull(raw.maximum);
  if (minimum === undefined || maximum === undefined) return null;
  if (signed !== null && typeof signed !== "string") return null;
  return {
    nutrient: nutrient as NutrientResult["nutrient"],
    unit,
    total,
    minimum,
    maximum,
    status: status as NutrientStatus,
    signed_number: signed,
  };
}

/** The result of a day: undefined when the response has none, null when it is malformed. */
export function parseDayResult(raw: unknown): DaySheetResult | null | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || !Array.isArray(raw.nutrients)) return null;
  if (raw.ranges_source !== "in_force" && raw.ranges_source !== "closed_copy") return null;
  const nutrients = raw.nutrients.map(parseNutrient);
  if (nutrients.some((n) => n === null)) return null;
  return { ranges_source: raw.ranges_source, nutrients: nutrients as NutrientResult[] };
}

/** The totals of a meal: undefined when the response has none, null when they are malformed. */
export function parseMealTotals(raw: unknown): MealTotals | null | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) return null;
  const { calories, protein, fat } = raw;
  if (typeof calories !== "number" || typeof protein !== "number" || typeof fat !== "number") return null;
  return { calories, protein, fat };
}

function parseSheet(raw: unknown): DaySheet | null {
  if (!isRecord(raw) || typeof raw.date !== "string" || typeof raw.today !== "string") return null;
  if (typeof raw.closed !== "boolean" || typeof raw.editable !== "boolean" || !Array.isArray(raw.meals)) return null;
  const result = parseDayResult(raw.result);
  if (result === null) return null;
  const meals: MealSheet[] = [];
  for (const m of raw.meals) {
    if (!isRecord(m) || !isMeal(m.meal) || !Array.isArray(m.entries)) return null;
    const entries = m.entries.map(parseEntry);
    if (entries.some((e) => e === null)) return null;
    const totals = parseMealTotals(m.totals);
    if (totals === null) return null;
    meals.push({ meal: m.meal, entries: entries as PlanEntry[], ...(totals ? { totals } : {}) });
  }
  return {
    date: raw.date,
    today: raw.today,
    closed: raw.closed,
    editable: raw.editable,
    meals,
    ...(result ? { result } : {}),
  };
}

export function messageOf(body: unknown): string | null {
  return isRecord(body) && typeof body.message === "string" && body.message !== "" ? body.message : null;
}

export function refusal(status: number, body: unknown): PlanError | null {
  if (![400, 404, 409, 422].includes(status) || !isRecord(body) || typeof body.code !== "string") return null;
  const reasons = Array.isArray(body.reasons) ? body.reasons.filter((x): x is string => typeof x === "string") : [];
  return { code: body.code, reasons, message: messageOf(body) };
}

export function createPlanApi(fetchFn: FetchLike, newRunId: () => string): PlanApi {
  async function send(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown } | null> {
    try {
      const headers: Record<string, string> = { "X-Run-Id": newRunId() };
      const init: RequestInit = { method, headers };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      const res = await fetchFn(path, init);
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
      return { status: res.status, body: parsed };
    } catch {
      return null;
    }
  }

  async function entryResult(r: { status: number; body: unknown } | null, okStatus: number): Promise<EntryResult> {
    if (!r) return { kind: "failed", message: null };
    if (r.status === 401) return { kind: "unauthorized" };
    if (r.status === okStatus) {
      const entry = parseEntry(r.body);
      return entry ? { kind: "ok", entry } : { kind: "failed", message: null };
    }
    const error = refusal(r.status, r.body);
    return error ? { kind: "refused", error } : { kind: "failed", message: messageOf(r.body) };
  }

  const day = (date: string) => `/days/${encodeURIComponent(date)}/plan`;
  const entryPath = (date: string, id: string) => `${day(date)}/entries/${encodeURIComponent(id)}`;

  return {
    async getDayPlan(date) {
      const r = await send("GET", day(date));
      if (!r) return { kind: "failed", message: null };
      if (r.status === 401) return { kind: "unauthorized" };
      const sheet = r.status === 200 ? parseSheet(r.body) : null;
      return sheet ? { kind: "ok", sheet } : { kind: "failed", message: messageOf(r.body) };
    },

    async addPlanEntry(date, input) {
      return entryResult(await send("POST", `${day(date)}/entries`, input), 201);
    },

    async changePlanEntry(date, entryId, amount) {
      return entryResult(await send("PATCH", entryPath(date, entryId), amount), 200);
    },

    async removePlanEntry(date, entryId) {
      const r = await send("DELETE", entryPath(date, entryId));
      if (!r) return { kind: "failed", message: null };
      if (r.status === 401) return { kind: "unauthorized" };
      if (r.status === 204) return { kind: "ok" };
      const error = refusal(r.status, r.body);
      return error ? { kind: "refused", error } : { kind: "failed", message: messageOf(r.body) };
    },
  };
}
