import { describe, expect, it } from "vitest";
import {
  OPEN,
  gateAfterRanges,
  gateAfterSave,
  initialSetup,
  parseLimit,
  saveNutrient,
  setField,
  withResult,
} from "./targets";
import type { Nutrient, RangeInput, SetRangeResult, TargetRange, TargetRanges, TargetsApi } from "./targetsApi";

const NONE: TargetRanges = { as_of: "2026-01-05", setup_complete: false, calories: null, protein: null, fat: null };

function range(nutrient: Nutrient, minimum: number, maximum: number): TargetRange {
  return { nutrient, minimum, maximum, unit: nutrient === "calories" ? "kcal" : "g", effective_from: "2026-01-05" };
}

function fakeApi(result: SetRangeResult) {
  const calls: { nutrient: Nutrient; input: RangeInput }[] = [];
  const api: TargetsApi = {
    async getTargetRanges() {
      return { kind: "ok", ranges: NONE };
    },
    async setTargetRange(nutrient, input) {
      calls.push({ nutrient, input });
      return result;
    },
  };
  return { api, calls };
}

describe("targets setup gate", () => {
  // cites: REQ-009/AC-001
  it("shows only the setup while setup_complete is false", () => {
    const gate = gateAfterRanges({ kind: "ok", ranges: NONE });
    expect(gate.phase).toBe("setup");
  });

  // cites: REQ-009/AC-001
  it("opens the app when setup_complete is true", () => {
    const ranges: TargetRanges = {
      as_of: "2026-01-05",
      setup_complete: true,
      calories: range("calories", 1800, 2200),
      protein: range("protein", 80, 120),
      fat: range("fat", 50, 70),
    };
    expect(gateAfterRanges({ kind: "ok", ranges })).toEqual(OPEN);
  });

  // cites: REQ-009/AC-001
  it("keeps the setup until all three ranges are saved, then opens", () => {
    const ok = { saved: true, error: null, unauthorized: false };
    let state = initialSetup(NONE);
    state = withResult(state, "calories", ok);
    expect(gateAfterSave(state).phase).toBe("setup");
    state = withResult(state, "protein", ok);
    expect(gateAfterSave(state).phase).toBe("setup");
    state = withResult(state, "fat", ok);
    expect(gateAfterSave(state)).toEqual(OPEN);
  });

  // cites: REQ-009/AC-001
  it("fails closed when the ranges cannot be read", () => {
    expect(gateAfterRanges({ kind: "failed", message: null }).phase).toBe("failed");
  });

  // cites: REQ-009/AC-001
  it("starts from the ranges already saved", () => {
    const state = initialSetup({ ...NONE, calories: range("calories", 1800, 2200) });
    expect(state.saved).toEqual({ calories: true, protein: false, fat: false });
    expect(state.fields.calories).toEqual({ min: "1800", max: "2200" });
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("offers only calories, protein and fat", () => {
    expect(Object.keys(initialSetup(NONE).fields)).toEqual(["calories", "protein", "fat"]);
  });
});

describe("saving one nutrient", () => {
  // cites: IF-001@1.4.0#setTargetRange
  it("sends one nutrient with numbers and reports it saved", async () => {
    const { api, calls } = fakeApi({ kind: "ok", range: range("calories", 1800, 2200) });
    const result = await saveNutrient(api, "calories", { min: "1800", max: "2200" });
    expect(calls).toEqual([{ nutrient: "calories", input: { minimum: 1800, maximum: 2200 } }]);
    expect(result).toEqual({ saved: true, error: null, unauthorized: false });
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("sends an empty limit as null and shows target.values_missing", async () => {
    const { api, calls } = fakeApi({ kind: "values_missing" });
    const result = await saveNutrient(api, "protein", { min: "80", max: "" });
    expect(calls[0]?.input).toEqual({ minimum: 80, maximum: null });
    expect(result.error).toBe("values_missing");
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("shows target.value_invalid and target.range_inverted from the server", async () => {
    const invalid = await saveNutrient(fakeApi({ kind: "value_invalid", invalid: ["minimum"] }).api, "calories", {
      min: "-1",
      max: "2200",
    });
    const inverted = await saveNutrient(fakeApi({ kind: "range_inverted" }).api, "calories", {
      min: "2000",
      max: "1800",
    });
    expect(invalid.error).toBe("value_invalid");
    expect(inverted.error).toBe("range_inverted");
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("does not send text that is no number", async () => {
    const { api, calls } = fakeApi({ kind: "ok", range: range("fat", 1, 2) });
    const result = await saveNutrient(api, "fat", { min: "abc", max: "70" });
    expect(calls).toEqual([]);
    expect(result.error).toBe("value_invalid");
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("reports unauthorized", async () => {
    const result = await saveNutrient(fakeApi({ kind: "unauthorized" }).api, "fat", { min: "1", max: "2" });
    expect(result.unauthorized).toBe(true);
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("puts the error on the right nutrient and keeps the fields as typed", () => {
    let state = initialSetup(NONE);
    state = setField(state, "protein", "min", "80");
    state = withResult(state, "protein", { saved: false, error: "values_missing", unauthorized: false });
    expect(state.errors).toEqual({ protein: "values_missing" });
    expect(state.fields.protein).toEqual({ min: "80", max: "" });
    expect(state.saved.protein).toBe(false);
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("keeps an earlier saved range saved when a later change is refused", () => {
    const state = withResult(initialSetup({ ...NONE, fat: range("fat", 50, 70) }), "fat", {
      saved: false,
      error: "range_inverted",
      unauthorized: false,
    });
    expect(state.saved.fat).toBe(true);
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("parses limits: empty is null, numbers are numbers, other text is invalid", () => {
    expect(parseLimit("  ")).toBeNull();
    expect(parseLimit("0")).toBe(0);
    expect(parseLimit("1800.5")).toBe(1800.5);
    expect(parseLimit("-1")).toBe(-1);
    expect(parseLimit("x1")).toBe("invalid");
  });
});
