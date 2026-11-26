// IF-001@1.5.0 plan operations (REQ-013): getDayPlan, addPlanEntry, changePlanEntry, removePlanEntry.
// Fetch and run id are injected. Types follow architecture/system/interfaces/IF-001/openapi-1.5.0.json.

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

export interface MealSheet {
  meal: Meal;
  entries: PlanEntry[];
}

export interface DaySheet {
  date: string;
  today: string;
  closed: boolean;
  editable: boolean;
  meals: MealSheet[];
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

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isMeal(x: unknown): x is Meal {
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

function parseEntry(raw: unknown): PlanEntry | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !isMeal(raw.meal)) return null;
  const product = parseSubject(raw.product);
  const dish = parseSubject(raw.dish);
  if (product === undefined || dish === undefined) return null;
  return { id: raw.id, meal: raw.meal, product, dish, grams: amountOf(raw.grams), pieces: amountOf(raw.pieces) };
}

function parseSheet(raw: unknown): DaySheet | null {
  if (!isRecord(raw) || typeof raw.date !== "string" || typeof raw.today !== "string") return null;
  if (typeof raw.closed !== "boolean" || typeof raw.editable !== "boolean" || !Array.isArray(raw.meals)) return null;
  const meals: MealSheet[] = [];
  for (const m of raw.meals) {
    if (!isRecord(m) || !isMeal(m.meal) || !Array.isArray(m.entries)) return null;
    const entries = m.entries.map(parseEntry);
    if (entries.some((e) => e === null)) return null;
    meals.push({ meal: m.meal, entries: entries as PlanEntry[] });
  }
  return { date: raw.date, today: raw.today, closed: raw.closed, editable: raw.editable, meals };
}

function messageOf(body: unknown): string | null {
  return isRecord(body) && typeof body.message === "string" && body.message !== "" ? body.message : null;
}

function refusal(status: number, body: unknown): PlanError | null {
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
