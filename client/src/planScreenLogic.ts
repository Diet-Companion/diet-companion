// Controller for the plan screen (REQ-013). Pure over injected deps: each step takes the state and returns the next.
// Today comes from getTargetRanges as_of, then from the day responses (ADR-016/C-003). The device clock is never read.

import type { Api, Product } from "./api";
import type { Dish, DishApi } from "./dishApi";
import type { DayResult, DaySheet, Meal, PlanApi, PlanEntry, PlanError } from "./planApi";
import { EMPTY_FORM, entryInput, errorText, formKey, nextDate, writeOutcome, type FormValues } from "./planLogic";
import type { TargetsApi } from "./targetsApi";

export interface PlanDeps {
  plan: PlanApi;
  targets: Pick<TargetsApi, "getTargetRanges">;
  products: Pick<Api, "listProducts">;
  dishes: Pick<DishApi, "listDishes">;
}

export interface ShownError {
  code: string;
  reasons: string[];
  text: string;
}

export interface PlanState {
  today: string;
  /** Today, then the next day. */
  days: DaySheet[];
  forms: Record<string, FormValues>;
  /** Typed amounts of entries, by entry id. */
  edits: Record<string, string>;
  error: ShownError | null;
}

export interface Catalogs {
  products: Product[];
  dishes: Dish[];
}

export type Opened =
  | { kind: "ok"; state: PlanState; catalogs: Catalogs }
  | { kind: "unauthorized" }
  | { kind: "failed" };

export type Next = { kind: "state"; state: PlanState } | { kind: "unauthorized" };

type DaysResult =
  | { kind: "ok"; today: string; days: DaySheet[] }
  | { kind: "unauthorized" }
  | { kind: "failed" };

function notOk(r: Exclude<DayResult, { kind: "ok" }>): { kind: "unauthorized" } | { kind: "failed" } {
  return r.kind === "unauthorized" ? { kind: "unauthorized" } : { kind: "failed" };
}

/** Reads the day `date` (the known today) and the day after the server's today. */
export async function readDays(deps: PlanDeps, date: string): Promise<DaysResult> {
  let want = date;
  for (let i = 0; i < 2; i++) {
    const first = await deps.plan.getDayPlan(want);
    if (first.kind !== "ok") return notOk(first);
    const today = first.sheet.today;
    // The server's today moved on: read the new today instead.
    if (first.sheet.date !== today && i === 0) {
      want = today;
      continue;
    }
    const following = nextDate(today);
    if (following === null) return { kind: "failed" };
    const second = await deps.plan.getDayPlan(following);
    if (second.kind !== "ok") return notOk(second);
    return { kind: "ok", today, days: [first.sheet, second.sheet] };
  }
  return { kind: "failed" };
}

/** The first read: as_of from getTargetRanges, then the two days and the pickers' catalogs. */
export async function openPlan(deps: PlanDeps): Promise<Opened> {
  const ranges = await deps.targets.getTargetRanges();
  if (ranges.kind === "unauthorized") return { kind: "unauthorized" };
  if (ranges.kind !== "ok") return { kind: "failed" };
  const days = await readDays(deps, ranges.ranges.as_of);
  if (days.kind !== "ok") return days;
  const products = await deps.products.listProducts("selectable");
  if (products.kind === "unauthorized") return { kind: "unauthorized" };
  if (products.kind !== "ok") return { kind: "failed" };
  const dishes = await deps.dishes.listDishes("selectable");
  if (dishes.kind === "unauthorized") return { kind: "unauthorized" };
  if (dishes.kind !== "ok") return { kind: "failed" };
  return {
    kind: "ok",
    state: { today: days.today, days: days.days, forms: {}, edits: {}, error: null },
    catalogs: { products: products.products, dishes: dishes.dishes },
  };
}

function shown(error: PlanError): ShownError {
  return { code: error.code, reasons: error.reasons, text: errorText(error) };
}

export function setForm(state: PlanState, date: string, meal: Meal, values: FormValues): PlanState {
  return { ...state, forms: { ...state.forms, [formKey(date, meal)]: values } };
}

export function setEdit(state: PlanState, entryId: string, text: string): PlanState {
  return { ...state, edits: { ...state.edits, [entryId]: text } };
}

// After a saved write the days are read again from the server, from the latest known today.
async function afterWrite(deps: PlanDeps, state: PlanState): Promise<Next> {
  const days = await readDays(deps, state.today);
  if (days.kind === "unauthorized") return { kind: "unauthorized" };
  if (days.kind === "failed") {
    const error = shown({ code: "failed", reasons: [], message: null });
    return { kind: "state", state: { ...state, error } };
  }
  return { kind: "state", state: { ...state, today: days.today, days: days.days, error: null } };
}

/** Adds the entry typed in the form of (date, meal). A refusal keeps the form as typed. */
export async function submitEntry(deps: PlanDeps, state: PlanState, date: string, meal: Meal): Promise<Next> {
  const key = formKey(date, meal);
  const form = state.forms[key] ?? EMPTY_FORM;
  const outcome = writeOutcome(await deps.plan.addPlanEntry(date, entryInput(meal, form)));
  if (outcome.kind === "login") return { kind: "unauthorized" };
  if (outcome.kind === "stay") return { kind: "state", state: { ...state, error: shown(outcome.error) } };
  const forms = { ...state.forms };
  delete forms[key];
  return afterWrite(deps, { ...state, forms });
}

export function amountText(entry: PlanEntry): string {
  if (entry.pieces !== null) return String(entry.pieces);
  return entry.grams !== null ? String(entry.grams) : "";
}

/** Changes the amount of an entry, in the unit it already has. Blank or unreadable text sends no amount. */
export async function changeAmount(deps: PlanDeps, state: PlanState, date: string, entry: PlanEntry): Promise<Next> {
  const text = (state.edits[entry.id] ?? amountText(entry)).trim();
  const n = text === "" ? Number.NaN : Number(text);
  const unit = entry.pieces !== null ? "pieces" : "grams";
  const amount = Number.isNaN(n) ? {} : { [unit]: n };
  const outcome = writeOutcome(await deps.plan.changePlanEntry(date, entry.id, amount));
  if (outcome.kind === "login") return { kind: "unauthorized" };
  if (outcome.kind === "stay") return { kind: "state", state: { ...state, error: shown(outcome.error) } };
  const edits = { ...state.edits };
  delete edits[entry.id];
  return afterWrite(deps, { ...state, edits });
}

export async function removeEntry(deps: PlanDeps, state: PlanState, date: string, entry: PlanEntry): Promise<Next> {
  const outcome = writeOutcome(await deps.plan.removePlanEntry(date, entry.id));
  if (outcome.kind === "login") return { kind: "unauthorized" };
  if (outcome.kind === "stay") return { kind: "state", state: { ...state, error: shown(outcome.error) } };
  const edits = { ...state.edits };
  delete edits[entry.id];
  return afterWrite(deps, { ...state, edits });
}
