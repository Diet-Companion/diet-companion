// Controller for the log screen (REQ-014). Pure over injected deps: each step takes the state and returns the next.
// Today comes from getTargetRanges as_of, then from the day responses (ADR-016/C-003). The device clock is never read.

import type { Api } from "./api";
import type { DishApi } from "./dishApi";
import type { LogApi, LogDay, LogEntry } from "./logApi";
import { logErrorText, prevDate } from "./logLogic";
import type { Meal, PlanError } from "./planApi";
import { EMPTY_FORM, entryInput, formKey, nextDate, writeOutcome, type FormValues, type WriteOutcome } from "./planLogic";
import { amountText, type Catalogs, type ShownError } from "./planScreenLogic";
import type { TargetsApi } from "./targetsApi";

export { amountText };

export interface LogDeps {
  log: LogApi;
  targets: Pick<TargetsApi, "getTargetRanges">;
  products: Pick<Api, "listProducts">;
  dishes: Pick<DishApi, "listDishes">;
}

export interface LogState {
  today: string;
  /** The day shown. */
  day: LogDay;
  forms: Record<string, FormValues>;
  /** Typed amounts of entries, by entry id. */
  edits: Record<string, string>;
  error: ShownError | null;
}

export type LogOpened =
  | { kind: "ok"; state: LogState; catalogs: Catalogs }
  | { kind: "unauthorized" }
  | { kind: "failed" };

export type LogNext = { kind: "state"; state: LogState } | { kind: "unauthorized" };

/** The first read: as_of from getTargetRanges, then that day and the pickers' catalogs. */
export async function openLog(deps: LogDeps): Promise<LogOpened> {
  const ranges = await deps.targets.getTargetRanges();
  if (ranges.kind === "unauthorized") return { kind: "unauthorized" };
  if (ranges.kind !== "ok") return { kind: "failed" };
  let read = await deps.log.getDayLog(ranges.ranges.as_of);
  // The server's today moved on: read the new today instead.
  if (read.kind === "ok" && read.day.date !== read.day.today) read = await deps.log.getDayLog(read.day.today);
  if (read.kind !== "ok") return read.kind === "unauthorized" ? { kind: "unauthorized" } : { kind: "failed" };
  const products = await deps.products.listProducts("selectable");
  if (products.kind === "unauthorized") return { kind: "unauthorized" };
  if (products.kind !== "ok") return { kind: "failed" };
  const dishes = await deps.dishes.listDishes("selectable");
  if (dishes.kind === "unauthorized") return { kind: "unauthorized" };
  if (dishes.kind !== "ok") return { kind: "failed" };
  return {
    kind: "ok",
    state: { today: read.day.today, day: read.day, forms: {}, edits: {}, error: null },
    catalogs: { products: products.products, dishes: dishes.dishes },
  };
}

function shown(error: PlanError): ShownError {
  return { code: error.code, reasons: error.reasons, text: logErrorText(error) };
}

export function setForm(state: LogState, meal: Meal, values: FormValues): LogState {
  return { ...state, forms: { ...state.forms, [formKey(state.day.date, meal)]: values } };
}

export function setEdit(state: LogState, entryId: string, text: string): LogState {
  return { ...state, edits: { ...state.edits, [entryId]: text } };
}

// Reads the day again from the server; a failed read keeps the screen and says so.
async function reread(deps: LogDeps, state: LogState, date: string): Promise<LogNext> {
  const r = await deps.log.getDayLog(date);
  if (r.kind === "unauthorized") return { kind: "unauthorized" };
  if (r.kind !== "ok") {
    return { kind: "state", state: { ...state, error: shown({ code: "failed", reasons: [], message: null }) } };
  }
  return { kind: "state", state: { ...state, today: r.day.today, day: r.day, error: null } };
}

/** Shows another day. A day after today is never read (A-035). */
export async function showDay(deps: LogDeps, state: LogState, date: string | null): Promise<LogNext> {
  if (date === null || date > state.today) return { kind: "state", state };
  return reread(deps, state, date);
}

export function earlierDay(deps: LogDeps, state: LogState): Promise<LogNext> {
  return showDay(deps, state, prevDate(state.day.date));
}

export function laterDay(deps: LogDeps, state: LogState): Promise<LogNext> {
  return showDay(deps, state, nextDate(state.day.date));
}

// A saved write is followed by a re-read of the shown day; a refusal keeps the state as it was, with the error.
async function finish(deps: LogDeps, state: LogState, outcome: WriteOutcome, saved: LogState): Promise<LogNext> {
  if (outcome.kind === "login") return { kind: "unauthorized" };
  if (outcome.kind === "stay") return { kind: "state", state: { ...state, error: shown(outcome.error) } };
  return reread(deps, saved, state.day.date);
}

/** Adds the entry typed in the form of (shown day, meal). A refusal keeps the form as typed. */
export async function submitEntry(deps: LogDeps, state: LogState, meal: Meal): Promise<LogNext> {
  const date = state.day.date;
  const key = formKey(date, meal);
  const form = state.forms[key] ?? EMPTY_FORM;
  const outcome = writeOutcome(await deps.log.addLogEntry(date, entryInput(meal, form)));
  const forms = { ...state.forms };
  delete forms[key];
  return finish(deps, state, outcome, { ...state, forms });
}

/** Changes the amount of an entry, in the unit it already has. Blank or unreadable text sends no amount. */
export async function changeAmount(deps: LogDeps, state: LogState, entry: LogEntry): Promise<LogNext> {
  const text = (state.edits[entry.id] ?? amountText(entry)).trim();
  const n = text === "" ? Number.NaN : Number(text);
  const unit = entry.pieces !== null ? "pieces" : "grams";
  const amount = Number.isNaN(n) ? {} : { [unit]: n };
  const outcome = writeOutcome(await deps.log.changeLogEntry(state.day.date, entry.id, amount));
  const edits = { ...state.edits };
  delete edits[entry.id];
  return finish(deps, state, outcome, { ...state, edits });
}

export async function removeEntry(deps: LogDeps, state: LogState, entry: LogEntry): Promise<LogNext> {
  const outcome = writeOutcome(await deps.log.removeLogEntry(state.day.date, entry.id));
  const edits = { ...state.edits };
  delete edits[entry.id];
  return finish(deps, state, outcome, { ...state, edits });
}

/** Copies the plan of the meal into the log (REQ-014/AC-001). The server refuses when the meal has no plan. */
export async function confirmMeal(deps: LogDeps, state: LogState, meal: Meal): Promise<LogNext> {
  const r = await deps.log.confirmMealAsPlanned(state.day.date, meal);
  const outcome = writeOutcome(r.kind === "ok" ? { kind: "ok" } : r);
  return finish(deps, state, outcome, state);
}
