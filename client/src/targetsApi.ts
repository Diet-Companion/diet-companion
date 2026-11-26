// IF-001@1.4.0 target operations (REQ-009): getTargetRanges and setTargetRange. Fetch and run id are injected.
// Types follow architecture/system/interfaces/IF-001/openapi-1.4.0.json.

import type { FetchLike } from "./api";

export const NUTRIENTS = ["calories", "protein", "fat"] as const;
export type Nutrient = (typeof NUTRIENTS)[number];

export interface TargetRange {
  nutrient: Nutrient;
  minimum: number;
  maximum: number;
  unit: "kcal" | "g";
  effective_from: string;
}

export interface TargetRanges {
  as_of: string;
  setup_complete: boolean;
  calories: TargetRange | null;
  protein: TargetRange | null;
  fat: TargetRange | null;
}

/** The body of setTargetRange. A null limit is sent as null; the server answers target.values_missing. */
export interface RangeInput {
  minimum: number | null;
  maximum: number | null;
}

export type RangesResult =
  | { kind: "ok"; ranges: TargetRanges }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string | null };

export type SetRangeResult =
  | { kind: "ok"; range: TargetRange }
  | { kind: "values_missing" }
  | { kind: "value_invalid"; invalid: string[] }
  | { kind: "range_inverted" }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string | null };

export interface TargetsApi {
  getTargetRanges(): Promise<RangesResult>;
  setTargetRange(nutrient: Nutrient, input: RangeInput): Promise<SetRangeResult>;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function messageOf(body: unknown): string | null {
  if (isRecord(body) && typeof body.message === "string" && body.message !== "") return body.message;
  return null;
}

function isNutrient(x: unknown): x is Nutrient {
  return x === "calories" || x === "protein" || x === "fat";
}

// null is a nutrient with no range yet; undefined is a body that is not a range.
function parseRange(raw: unknown): TargetRange | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  const { nutrient, minimum, maximum, unit, effective_from } = raw;
  if (
    !isNutrient(nutrient) ||
    typeof minimum !== "number" ||
    typeof maximum !== "number" ||
    (unit !== "kcal" && unit !== "g") ||
    typeof effective_from !== "string"
  ) {
    return undefined;
  }
  return { nutrient, minimum, maximum, unit, effective_from };
}

function parseRanges(raw: unknown): TargetRanges | null {
  if (!isRecord(raw)) return null;
  const { as_of, setup_complete } = raw;
  const calories = parseRange(raw.calories);
  const protein = parseRange(raw.protein);
  const fat = parseRange(raw.fat);
  if (
    typeof as_of !== "string" ||
    typeof setup_complete !== "boolean" ||
    calories === undefined ||
    protein === undefined ||
    fat === undefined
  ) {
    return null;
  }
  return { as_of, setup_complete, calories, protein, fat };
}

async function rangesResult(res: Response): Promise<RangesResult> {
  if (res.status === 401) return { kind: "unauthorized" };
  const body = await readBody(res);
  if (res.status === 200) {
    const ranges = parseRanges(body);
    if (ranges) return { kind: "ok", ranges };
  }
  return { kind: "failed", message: messageOf(body) };
}

async function setResult(res: Response): Promise<SetRangeResult> {
  if (res.status === 401) return { kind: "unauthorized" };
  const body = await readBody(res);
  if (res.status === 200) {
    const range = parseRange(body);
    return range ? { kind: "ok", range } : { kind: "failed", message: null };
  }
  if (res.status === 400 && isRecord(body)) {
    if (body.code === "target.range_inverted") return { kind: "range_inverted" };
    if (body.code === "target.value_invalid") {
      const invalid = Array.isArray(body.invalid)
        ? body.invalid.filter((x): x is string => typeof x === "string")
        : [];
      return { kind: "value_invalid", invalid };
    }
  }
  if (res.status === 422 && isRecord(body) && body.code === "target.values_missing") {
    return { kind: "values_missing" };
  }
  return { kind: "failed", message: messageOf(body) };
}

export function createTargetsApi(fetchFn: FetchLike, newRunId: () => string): TargetsApi {
  return {
    async getTargetRanges() {
      try {
        const res = await fetchFn("/target-ranges", { method: "GET", headers: { "X-Run-Id": newRunId() } });
        return await rangesResult(res);
      } catch {
        return { kind: "failed", message: null };
      }
    },

    async setTargetRange(nutrient, input) {
      try {
        const res = await fetchFn(`/target-ranges/${encodeURIComponent(nutrient)}`, {
          method: "PUT",
          headers: { "X-Run-Id": newRunId(), "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        return await setResult(res);
      } catch {
        return { kind: "failed", message: null };
      }
    },
  };
}
