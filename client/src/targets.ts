// Pure logic of the targets setup (REQ-009/AC-001): the gate, the form state and one save.
// The server decides what a valid range is (R-011); the client only shows the answer.

import {
  NUTRIENTS,
  type Nutrient,
  type RangesResult,
  type TargetRange,
  type TargetRanges,
  type TargetsApi,
} from "./targetsApi";

export type TargetErrorCode = "values_missing" | "value_invalid" | "range_inverted" | "failed";

export const TARGET_LABELS: Record<Nutrient, string> = {
  calories: "Calories (kcal per day)",
  protein: "Protein (g per day)",
  fat: "Fat (g per day)",
};

export const TARGET_ERROR_TEXT: Record<TargetErrorCode, string> = {
  values_missing: "Enter both a minimum and a maximum. Nothing was saved.",
  value_invalid: "Limits must be whole numbers from 0 upward. Nothing was saved.",
  range_inverted: "The minimum can't be higher than the maximum. Nothing was saved.",
  failed: "The range could not be saved. Try again.",
};

export interface RangeFields {
  min: string;
  max: string;
}

export interface SetupState {
  fields: Record<Nutrient, RangeFields>;
  saved: Record<Nutrient, boolean>;
  errors: Partial<Record<Nutrient, TargetErrorCode>>;
}

/** While the gate is not open, only the setup (or a wait or retry) shows. */
export type TargetsGate =
  | { phase: "checking" }
  | { phase: "setup"; state: SetupState }
  | { phase: "failed" }
  | { phase: "open" };

export const CHECKING: TargetsGate = { phase: "checking" };
export const OPEN: TargetsGate = { phase: "open" };

function fieldsOf(range: TargetRange | null): RangeFields {
  return range ? { min: String(range.minimum), max: String(range.maximum) } : { min: "", max: "" };
}

export function initialSetup(ranges: TargetRanges): SetupState {
  return {
    fields: {
      calories: fieldsOf(ranges.calories),
      protein: fieldsOf(ranges.protein),
      fat: fieldsOf(ranges.fat),
    },
    saved: {
      calories: ranges.calories !== null,
      protein: ranges.protein !== null,
      fat: ranges.fat !== null,
    },
    errors: {},
  };
}

export function isSetupComplete(state: SetupState): boolean {
  return NUTRIENTS.every((n) => state.saved[n]);
}

export function gateAfterRanges(result: RangesResult): TargetsGate {
  if (result.kind === "ok") {
    return result.ranges.setup_complete ? OPEN : { phase: "setup", state: initialSetup(result.ranges) };
  }
  // Unauthorized goes to the sign-in screen, which is reachable on its own.
  return result.kind === "unauthorized" ? OPEN : { phase: "failed" };
}

export function setField(state: SetupState, nutrient: Nutrient, which: "min" | "max", value: string): SetupState {
  return { ...state, fields: { ...state.fields, [nutrient]: { ...state.fields[nutrient], [which]: value } } };
}

/** Empty text is null (the server answers values_missing); text that is no number is "invalid". */
export function parseLimit(text: string): number | null | "invalid" {
  const t = text.trim();
  if (t === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return "invalid";
  return Number(t);
}

export interface SaveResult {
  saved: boolean;
  error: TargetErrorCode | null;
  unauthorized: boolean;
}

export async function saveNutrient(api: TargetsApi, nutrient: Nutrient, fields: RangeFields): Promise<SaveResult> {
  const minimum = parseLimit(fields.min);
  const maximum = parseLimit(fields.max);
  if (minimum === "invalid" || maximum === "invalid") {
    return { saved: false, error: "value_invalid", unauthorized: false };
  }
  const result = await api.setTargetRange(nutrient, { minimum, maximum });
  switch (result.kind) {
    case "ok":
      return { saved: true, error: null, unauthorized: false };
    case "unauthorized":
      return { saved: false, error: null, unauthorized: true };
    case "failed":
      return { saved: false, error: "failed", unauthorized: false };
    default:
      return { saved: false, error: result.kind, unauthorized: false };
  }
}

/** A refusal keeps the fields as typed and leaves the saved flag as it was. */
export function withResult(state: SetupState, nutrient: Nutrient, result: SaveResult): SetupState {
  if (result.unauthorized) return state;
  const errors = { ...state.errors };
  if (result.error) errors[nutrient] = result.error;
  else delete errors[nutrient];
  return { ...state, saved: { ...state.saved, [nutrient]: result.saved || state.saved[nutrient] }, errors };
}

export function gateAfterSave(state: SetupState): TargetsGate {
  return isSetupComplete(state) ? OPEN : { phase: "setup", state };
}
