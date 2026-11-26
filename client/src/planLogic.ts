// Pure helpers for the plan screen (REQ-013). The server decides what is valid; the client only builds
// the request from what was typed and words the answer.

import type { EntryResult, Meal, NewEntryInput, PlanError, PlanSubject, RemoveResult } from "./planApi";

export interface FormValues {
  /** "" for none, "p:<id>" for a product, "d:<id>" for a dish. */
  subject: string;
  grams: string;
  pieces: string;
}

export const EMPTY_FORM: FormValues = { subject: "", grams: "", pieces: "" };

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Breakfast",
  brunch: "Brunch",
  lunch: "Lunch",
  afternoon_snack: "Afternoon snack",
  dinner: "Dinner",
};

export function formKey(date: string, meal: Meal): string {
  return `${date}|${meal}`;
}

/** The day after a YYYY-MM-DD date, by calendar arithmetic only. Never reads the device clock (ADR-016/C-003). */
export function nextDate(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1)).toISOString().slice(0, 10);
}

// Blank or unreadable text sends no amount, so the server answers amount_missing. 150.5 is sent as 150.5.
function numberOf(text: string): number | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isNaN(n) ? undefined : n;
}

export function entryInput(meal: Meal, form: FormValues): NewEntryInput {
  const input: NewEntryInput = { meal };
  if (form.subject.startsWith("d:")) {
    input.dish_id = form.subject.slice(2);
    return input;
  }
  if (form.subject.startsWith("p:")) input.product_id = form.subject.slice(2);
  const grams = numberOf(form.grams);
  const pieces = numberOf(form.pieces);
  if (grams !== undefined) input.grams = grams;
  if (pieces !== undefined) input.pieces = pieces;
  return input;
}

const REASON_TEXT: Record<string, string> = {
  amount_invalid: "The amount must be a whole number of 1 or more. Nothing was saved.",
  amount_missing: "Enter an amount in grams or in pieces. Nothing was saved.",
  amount_on_dish: "A dish is planned whole, without an amount. Nothing was saved.",
  piece_without_weight: "This product has no piece weight, so it cannot be planned in pieces. Nothing was saved.",
  subject_missing: "Choose a product or a dish. Nothing was saved.",
};

const CODE_TEXT: Record<string, string> = {
  "plan.day_out_of_range": "Only today and the next day can be planned. Nothing was saved.",
  "day.closed": "This day is closed and cannot be changed. Nothing was saved.",
};

export function errorText(error: PlanError): string {
  const reason = error.reasons.map((r) => REASON_TEXT[r]).find((t) => t !== undefined);
  return reason ?? CODE_TEXT[error.code] ?? error.message ?? "The plan could not be saved.";
}

export function markOf(s: PlanSubject): string {
  return s.deleted ? " (deleted)" : s.replaced ? " (replaced)" : "";
}

export type WriteOutcome = { kind: "saved" } | { kind: "stay"; error: PlanError } | { kind: "login" };

export function writeOutcome(r: EntryResult | RemoveResult): WriteOutcome {
  if (r.kind === "ok") return { kind: "saved" };
  if (r.kind === "unauthorized") return { kind: "login" };
  if (r.kind === "refused") return { kind: "stay", error: r.error };
  return { kind: "stay", error: { code: "failed", reasons: [], message: r.message } };
}
