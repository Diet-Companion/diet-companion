// IF-001@1.5.0 log operations (REQ-014): getDayLog, addLogEntry, changeLogEntry, removeLogEntry,
// confirmMealAsPlanned, and addLogDishProducts (REQ-014/AC-005, AC-010). Fetch and run id are injected.
// Types follow architecture/system/interfaces/IF-001/openapi-1.5.0.json.

import type { FetchLike } from "./api";
import {
  isMeal,
  isRecord,
  messageOf,
  parseEntry,
  refusal,
  type AmountInput,
  type Meal,
  type NewEntryInput,
  type PlanEntry,
  type PlanError,
  type RemoveResult,
} from "./planApi";

/** A log entry: the plan entry shape plus what the response gives for its weight and its product. */
export interface LogEntry extends PlanEntry {
  /** weight_grams of the response: grams, or pieces times the piece weight (REQ-014/AC-008). */
  weightGrams: number | null;
  /** The product's calories per 100 g as the response carries them, or null. */
  caloriesPer100: number | null;
}

export interface LogMeal {
  meal: Meal;
  /** True when the plan of the day has entries for the meal (REQ-014/AC-013). */
  hasPlan: boolean;
  entries: LogEntry[];
}

export interface LogDay {
  date: string;
  today: string;
  closed: boolean;
  editable: boolean;
  meals: LogMeal[];
}

type Problem =
  | { kind: "refused"; error: PlanError }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string | null };

export type LogDayResult = { kind: "ok"; day: LogDay } | Exclude<Problem, { kind: "refused" }>;
export type LogEntryResult = { kind: "ok"; entry: LogEntry } | Problem;
export type LogEntriesResult = { kind: "ok"; entries: LogEntry[] } | Problem;

/** One override of a dish line by its position (DishProductsInput.lines). */
export interface DishLineOverride {
  position: number;
  grams?: number;
  pieces?: number;
}

export interface DishProductsInput {
  meal: Meal;
  dish_id: string;
  /** Only the changed lines; a position not listed keeps the dish amount. */
  lines?: DishLineOverride[];
}

/** A refused line of EntryInvalid: index into the request's lines, and the reason. */
export interface LineRefusal {
  index: number;
  reason: string;
}

export type LogSplitResult =
  | { kind: "ok"; entries: LogEntry[] }
  | { kind: "refused"; error: PlanError; lines: LineRefusal[] }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string | null };

export interface LogApi {
  getDayLog(date: string): Promise<LogDayResult>;
  addLogEntry(date: string, input: NewEntryInput): Promise<LogEntryResult>;
  changeLogEntry(date: string, entryId: string, amount: AmountInput): Promise<LogEntryResult>;
  removeLogEntry(date: string, entryId: string): Promise<RemoveResult>;
  confirmMealAsPlanned(date: string, meal: Meal): Promise<LogEntriesResult>;
}

export interface LogSplitApi {
  addLogDishProducts(date: string, input: DishProductsInput): Promise<LogSplitResult>;
}

function parseLogEntry(raw: unknown): LogEntry | null {
  const base = parseEntry(raw);
  if (!base || !isRecord(raw)) return null;
  const product = isRecord(raw.product) ? raw.product : null;
  return {
    ...base,
    weightGrams: typeof raw.weight_grams === "number" ? raw.weight_grams : null,
    caloriesPer100: product !== null && typeof product.calories === "number" ? product.calories : null,
  };
}

function parseDay(raw: unknown): LogDay | null {
  if (!isRecord(raw) || typeof raw.date !== "string" || typeof raw.today !== "string") return null;
  if (typeof raw.closed !== "boolean" || typeof raw.editable !== "boolean" || !Array.isArray(raw.meals)) return null;
  const meals: LogMeal[] = [];
  for (const m of raw.meals) {
    if (!isRecord(m) || !isMeal(m.meal) || typeof m.has_plan !== "boolean" || !Array.isArray(m.entries)) return null;
    const entries = m.entries.map(parseLogEntry);
    if (entries.some((e) => e === null)) return null;
    meals.push({ meal: m.meal, hasPlan: m.has_plan, entries: entries as LogEntry[] });
  }
  return { date: raw.date, today: raw.today, closed: raw.closed, editable: raw.editable, meals };
}

function parseEntries(raw: unknown): LogEntry[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.entries)) return null;
  const entries = raw.entries.map(parseLogEntry);
  return entries.some((e) => e === null) ? null : (entries as LogEntry[]);
}

// The refused lines of an EntryInvalid body; anything that is not {index, reason} is dropped.
function refusedLines(raw: unknown): LineRefusal[] {
  const out: LineRefusal[] = [];
  if (!isRecord(raw) || !Array.isArray(raw.lines)) return out;
  for (const l of raw.lines) {
    if (isRecord(l) && typeof l.index === "number" && typeof l.reason === "string") {
      out.push({ index: l.index, reason: l.reason });
    }
  }
  return out;
}

type Sent = { status: number; body: unknown } | null;

// What a reply that is not the expected success means.
function problem(r: Sent): Problem {
  if (!r) return { kind: "failed", message: null };
  if (r.status === 401) return { kind: "unauthorized" };
  const error = refusal(r.status, r.body);
  return error ? { kind: "refused", error } : { kind: "failed", message: messageOf(r.body) };
}

export function createLogApi(fetchFn: FetchLike, newRunId: () => string): LogApi & LogSplitApi {
  async function send(method: string, path: string, body?: unknown): Promise<Sent> {
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

  async function entryResult(r: Sent, okStatus: number): Promise<LogEntryResult> {
    if (r && r.status === okStatus) {
      const entry = parseLogEntry(r.body);
      return entry ? { kind: "ok", entry } : { kind: "failed", message: null };
    }
    return problem(r);
  }

  const day = (date: string) => `/days/${encodeURIComponent(date)}/log`;
  const entryPath = (date: string, id: string) => `${day(date)}/entries/${encodeURIComponent(id)}`;

  return {
    async getDayLog(date) {
      const r = await send("GET", day(date));
      if (r && r.status === 200) {
        const parsed = parseDay(r.body);
        return parsed ? { kind: "ok", day: parsed } : { kind: "failed", message: null };
      }
      const p = problem(r);
      return p.kind === "refused" ? { kind: "failed", message: p.error.message } : p;
    },

    async addLogEntry(date, input) {
      return entryResult(await send("POST", `${day(date)}/entries`, input), 201);
    },

    async changeLogEntry(date, entryId, amount) {
      return entryResult(await send("PATCH", entryPath(date, entryId), amount), 200);
    },

    async removeLogEntry(date, entryId) {
      const r = await send("DELETE", entryPath(date, entryId));
      if (r && r.status === 204) return { kind: "ok" };
      return problem(r);
    },

    async confirmMealAsPlanned(date, meal) {
      const r = await send("POST", `${day(date)}/meals/${encodeURIComponent(meal)}/confirm`);
      if (r && r.status === 201) {
        const entries = parseEntries(r.body);
        return entries ? { kind: "ok", entries } : { kind: "failed", message: null };
      }
      return problem(r);
    },

    async addLogDishProducts(date, input) {
      const r = await send("POST", `${day(date)}/dish-products`, input);
      if (r && r.status === 201) {
        const entries = parseEntries(r.body);
        return entries ? { kind: "ok", entries } : { kind: "failed", message: null };
      }
      const p = problem(r);
      if (p.kind !== "refused") return p;
      return { kind: "refused", error: p.error, lines: r ? refusedLines(r.body) : [] };
    },
  };
}
