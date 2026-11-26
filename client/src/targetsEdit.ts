// Pure logic of changing target ranges later (REQ-009/AC-002 to AC-010). The server decides what a valid range
// is (R-011) and what today is (ADR-016/C-003); the client sends two limits and shows the answer.

import { parseLimit, type RangeFields, type TargetErrorCode } from "./targets";
import { type Nutrient, type TargetRange, type TargetRanges, type TargetsApi } from "./targetsApi";

export interface EditState {
  asOf: string;
  ranges: Record<Nutrient, TargetRange | null>;
  fields: Record<Nutrient, RangeFields>;
  errors: Partial<Record<Nutrient, TargetErrorCode>>;
}

export type LoadResult = { kind: "ok"; state: EditState } | { kind: "unauthorized" } | { kind: "failed" };

export type RangeOutcome =
  | { kind: "saved"; range: TargetRange }
  | { kind: "refused"; error: TargetErrorCode }
  | { kind: "unauthorized" };

function fieldsOf(range: TargetRange | null): RangeFields {
  return range ? { min: String(range.minimum), max: String(range.maximum) } : { min: "", max: "" };
}

export function editFromRanges(ranges: TargetRanges): EditState {
  return {
    asOf: ranges.as_of,
    ranges: { calories: ranges.calories, protein: ranges.protein, fat: ranges.fat },
    fields: { calories: fieldsOf(ranges.calories), protein: fieldsOf(ranges.protein), fat: fieldsOf(ranges.fat) },
    errors: {},
  };
}

export async function loadEdit(api: TargetsApi): Promise<LoadResult> {
  const result = await api.getTargetRanges();
  if (result.kind === "ok") return { kind: "ok", state: editFromRanges(result.ranges) };
  return result.kind === "unauthorized" ? { kind: "unauthorized" } : { kind: "failed" };
}

export function setEditField(state: EditState, nutrient: Nutrient, which: "min" | "max", value: string): EditState {
  return { ...state, fields: { ...state.fields, [nutrient]: { ...state.fields[nutrient], [which]: value } } };
}

/** Sends one nutrient with the typed limits. No date is sent: the server applies the change from its today. */
export async function sendRange(api: TargetsApi, nutrient: Nutrient, fields: RangeFields): Promise<RangeOutcome> {
  const minimum = parseLimit(fields.min);
  const maximum = parseLimit(fields.max);
  if (minimum === "invalid" || maximum === "invalid") return { kind: "refused", error: "value_invalid" };
  const result = await api.setTargetRange(nutrient, { minimum, maximum });
  switch (result.kind) {
    case "ok":
      return { kind: "saved", range: result.range };
    case "unauthorized":
      return { kind: "unauthorized" };
    case "failed":
      return { kind: "refused", error: "failed" };
    default:
      return { kind: "refused", error: result.kind };
  }
}

/**
 * A saved range replaces the one shown, with the server's effective_from. A refusal keeps the fields as typed
 * and the range in force as it was. Only the named nutrient changes.
 */
export function applyOutcome(state: EditState, nutrient: Nutrient, outcome: RangeOutcome): EditState {
  if (outcome.kind === "unauthorized") return state;
  const errors = { ...state.errors };
  if (outcome.kind === "refused") {
    errors[nutrient] = outcome.error;
    return { ...state, errors };
  }
  delete errors[nutrient];
  return {
    ...state,
    ranges: { ...state.ranges, [nutrient]: outcome.range },
    fields: { ...state.fields, [nutrient]: fieldsOf(outcome.range) },
    errors,
  };
}

export function describeRange(range: TargetRange | null): string {
  if (!range) return "No range set.";
  return `Minimum ${range.minimum}, maximum ${range.maximum} ${range.unit}, in force from ${range.effective_from}.`;
}
