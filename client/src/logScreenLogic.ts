// Controller for the log screen (REQ-014). Pure over injected deps: each step takes the state and returns the next.
// Today comes from getTargetRanges as_of, then from the day responses (ADR-016/C-003). The device clock is never read.

import type { Api } from "./api";
import type { Dish, DishApi } from "./dishApi";
import type { DishLineOverride, DishProductsInput, LogApi, LogDay, LogEntry, LogSplitApi } from "./logApi";
import { logErrorText, prevDate } from "./logLogic";
import type { Meal, PlanError } from "./planApi";
import { EMPTY_FORM, entryInput, formKey, nextDate, writeOutcome, type FormValues, type WriteOutcome } from "./planLogic";
import { amountText, type Catalogs, type ShownError } from "./planScreenLogic";
import type { TargetsApi } from "./targetsApi";

export { amountText };

export interface LogDeps {
  log: LogApi & Partial<LogSplitApi>;
  targets: Pick<TargetsApi, "getTargetRanges">;
  products: Pick<Api, "listProducts">;
  /** Read only: the dish split never writes a dish (REQ-014/AC-010). */
  dishes: Pick<DishApi, "listDishes">;
}

/** One line of the dish split form, typed amounts as text, with the dish amounts they started from. */
export interface SplitLine {
  position: number;
  name: string;
  grams: string;
  pieces: string;
  origGrams: string;
  origPieces: string;
}

export interface SplitForm {
  /** "" while no dish is chosen. */
  dishId: string;
  lines: SplitLine[];
  /** Refused lines of the last save, by dish position: the reason. */
  refused: Record<number, string>;
}

export interface LogState {
  today: string;
  /** The day shown. */
  day: LogDay;
  forms: Record<string, FormValues>;
  /** Typed amounts of entries, by entry id. */
  edits: Record<string, string>;
  error: ShownError | null;
  /** Open dish split forms, by formKey(date, meal). */
  splits?: Record<string, SplitForm>;
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

// ---- Log a dish as separate products (REQ-014/AC-005, REQ-014/AC-010) ----

const EMPTY_SPLIT: SplitForm = { dishId: "", lines: [], refused: {} };

function withSplit(state: LogState, key: string, form: SplitForm | null): LogState {
  const splits = { ...(state.splits ?? {}) };
  if (form === null) delete splits[key];
  else splits[key] = form;
  return { ...state, splits };
}

const amountString = (n: number | null): string => (n === null ? "" : String(n));

/** Opens the split form of (shown day, meal), with no dish chosen yet. An open form is kept as it is. */
export function openSplit(state: LogState, meal: Meal): LogState {
  const key = formKey(state.day.date, meal);
  return state.splits?.[key] ? state : withSplit(state, key, EMPTY_SPLIT);
}

/** Chooses the dish to split: its lines with the dish amounts prefilled. No dish clears the lines. */
export function chooseSplitDish(state: LogState, meal: Meal, dish: Dish | undefined): LogState {
  const key = formKey(state.day.date, meal);
  if (!dish) return withSplit(state, key, EMPTY_SPLIT);
  const lines = dish.lines.map((l) => ({
    position: l.position,
    name: l.product.name,
    grams: amountString(l.grams),
    pieces: amountString(l.pieces),
    origGrams: amountString(l.grams),
    origPieces: amountString(l.pieces),
  }));
  return withSplit(state, key, { dishId: dish.id, lines, refused: {} });
}

/** Types an amount of one dish line (by dish position). */
export function setSplitLine(state: LogState, meal: Meal, position: number, values: { grams: string; pieces: string }): LogState {
  const key = formKey(state.day.date, meal);
  const form = state.splits?.[key];
  if (!form) return state;
  const refused = { ...form.refused };
  delete refused[position];
  const lines = form.lines.map((l) => (l.position === position ? { ...l, grams: values.grams, pieces: values.pieces } : l));
  return withSplit(state, key, { ...form, lines, refused });
}

// Blank or unreadable text sends no amount; the server answers for it.
function numberOf(text: string): number | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isNaN(n) ? undefined : n;
}

/** The request: only the lines whose amounts were changed, by dish position. A line left as is keeps the dish amount. */
export function splitRequest(meal: Meal, form: SplitForm): DishProductsInput {
  const lines: DishLineOverride[] = [];
  for (const l of form.lines) {
    if (l.grams === l.origGrams && l.pieces === l.origPieces) continue;
    const override: DishLineOverride = { position: l.position };
    const grams = numberOf(l.grams);
    const pieces = numberOf(l.pieces);
    if (grams !== undefined) override.grams = grams;
    if (pieces !== undefined) override.pieces = pieces;
    lines.push(override);
  }
  const input: DishProductsInput = { meal, dish_id: form.dishId };
  if (lines.length > 0) input.lines = lines;
  return input;
}

/**
 * Saves the open split form of (shown day, meal) with addLogDishProducts only; never a dish write.
 * A refusal keeps the form as typed and saves nothing (all or none is the server's).
 */
export async function submitSplit(deps: LogDeps, state: LogState, meal: Meal): Promise<LogNext> {
  const date = state.day.date;
  const key = formKey(date, meal);
  const form = state.splits?.[key] ?? EMPTY_SPLIT;
  const add = deps.log.addLogDishProducts?.bind(deps.log);
  if (!add) {
    return { kind: "state", state: { ...state, error: shown({ code: "failed", reasons: [], message: null }) } };
  }
  const request = splitRequest(meal, form);
  const r = await add(date, request);
  if (r.kind === "unauthorized") return { kind: "unauthorized" };
  if (r.kind === "ok") return reread(deps, withSplit(state, key, null), date);
  if (r.kind === "failed") {
    return { kind: "state", state: { ...state, error: shown({ code: "failed", reasons: [], message: r.message }) } };
  }
  // The index of a refused line is into the request's lines; map it back to the dish position.
  const sent = request.lines ?? [];
  const refused: Record<number, string> = {};
  const reasons = [...r.error.reasons];
  for (const l of r.lines) {
    refused[sent[l.index]?.position ?? l.index] = l.reason;
    if (!reasons.includes(l.reason)) reasons.push(l.reason);
  }
  const names = Object.keys(refused).map((p) => {
    const position = Number(p);
    const name = form.lines.find((l) => l.position === position)?.name;
    return name !== undefined ? `Line ${position + 1} (${name})` : `Line ${position + 1}`;
  });
  const base = logErrorText({ ...r.error, reasons });
  const error: ShownError = {
    code: r.error.code,
    reasons,
    text: names.length > 0 ? `${names.join(", ")}: ${base}` : base,
  };
  return { kind: "state", state: { ...withSplit(state, key, { ...form, refused }), error } };
}
