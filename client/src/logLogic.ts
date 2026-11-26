// Pure helpers for the log screen (REQ-014). The server decides what is valid; the client words the answer.

import { errorText } from "./planLogic";
import type { PlanError } from "./planApi";

/** The day before a YYYY-MM-DD date, by calendar arithmetic only. Never reads the device clock (ADR-016/C-003). */
export function prevDate(date: string): string | null {
  const [y, m, d] = date.split("-").map(Number);
  if (date.length !== 10 || !y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** A day after today is never offered (A-035). Dates are YYYY-MM-DD, so text order is date order. */
export function canShowLater(date: string, today: string): boolean {
  return date < today;
}

const LOG_REASON_TEXT: Record<string, string> = {
  amount_invalid: "The amount must be a whole number of 1 or more. Nothing was saved.",
  amount_missing: "Enter an amount in grams or in pieces. Nothing was saved.",
  amount_on_dish: "A dish is logged whole, without an amount. Nothing was saved.",
  piece_without_weight: "This product has no piece weight, so it cannot be logged in pieces. Nothing was saved.",
  subject_missing: "Choose a product or a dish. Nothing was saved.",
};

const LOG_CODE_TEXT: Record<string, string> = {
  "log.day_out_of_range": "A day after today cannot be logged. Nothing was saved.",
  "log.meal_not_empty": "This meal already has log entries, so the plan cannot be confirmed. Nothing was saved.",
  "plan.meal_empty": "This meal has no plan to confirm. Nothing was logged.",
  "day.closed": "This day is closed and cannot be changed. Nothing was saved.",
};

export function logErrorText(error: PlanError): string {
  const reason = error.reasons.map((r) => LOG_REASON_TEXT[r]).find((t) => t !== undefined);
  if (reason !== undefined) return reason;
  const byCode = LOG_CODE_TEXT[error.code];
  if (byCode !== undefined) return byCode;
  if (error.message !== null) return error.message;
  return error.code === "failed" ? "The log could not be saved." : errorText({ ...error, message: "The log could not be saved." });
}
