import type { LabelValues } from "./index.js";

/** The outcome of comparing a smoke read with the synthetic label's known values. */
export type SmokeResult = { ok: true } | { ok: false; mismatched: string[] };

const EPSILON = 1e-9;

function within(value: number | null, expected: number, tolerance: number): boolean {
  return value !== null && Math.abs(value - expected) <= tolerance + EPSILON;
}

/**
 * Compares the values read from the synthetic smoke label with its known values (#98).
 * Brand and shop are not required. A null value is a mismatch.
 */
export function checkSmoke(values: LabelValues): SmokeResult {
  const mismatched: string[] = [];
  if (values.name === null || !values.name.toLowerCase().includes("smoke test crackers")) mismatched.push("name");
  if (!within(values.calories, 250, 2)) mismatched.push("calories");
  if (!within(values.protein, 9, 0.5)) mismatched.push("protein");
  if (!within(values.fat, 3.5, 0.5)) mismatched.push("fat");
  return mismatched.length === 0 ? { ok: true } : { ok: false, mismatched };
}
