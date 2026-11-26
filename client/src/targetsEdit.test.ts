import { describe, expect, it } from "vitest";
import { applyOutcome, editFromRanges, loadEdit, sendRange, setEditField } from "./targetsEdit";
import type { Nutrient, RangeInput, SetRangeResult, TargetRange, TargetRanges, TargetsApi } from "./targetsApi";

function range(nutrient: Nutrient, minimum: number, maximum: number, effective_from: string): TargetRange {
  return { nutrient, minimum, maximum, unit: nutrient === "calories" ? "kcal" : "g", effective_from };
}

const IN_FORCE: TargetRanges = {
  as_of: "2026-01-05",
  setup_complete: true,
  calories: range("calories", 1800, 2200, "2026-01-01"),
  protein: range("protein", 80, 120, "2026-01-02"),
  fat: range("fat", 50, 70, "2026-01-03"),
};

function fakeApi(result: SetRangeResult) {
  const calls: { nutrient: Nutrient; input: RangeInput }[] = [];
  const api: TargetsApi = {
    async getTargetRanges() {
      return { kind: "ok", ranges: IN_FORCE };
    },
    async setTargetRange(nutrient, input) {
      calls.push({ nutrient, input });
      return result;
    },
  };
  return { api, calls };
}

describe("changing target ranges", () => {
  // cites: IF-001@1.4.0#getTargetRanges
  it("shows each range in force with its effective_from, and as_of", async () => {
    const loaded = await loadEdit(fakeApi({ kind: "failed", message: null }).api);
    expect(loaded.kind).toBe("ok");
    if (loaded.kind !== "ok") return;
    expect(loaded.state.asOf).toBe("2026-01-05");
    expect(loaded.state.ranges.calories?.effective_from).toBe("2026-01-01");
    expect(loaded.state.fields.fat).toEqual({ min: "50", max: "70" });
  });

  // cites: REQ-009/AC-002, R-011
  it("keeps what was typed and the range in force when the minimum is above the maximum", async () => {
    const { api, calls } = fakeApi({ kind: "range_inverted" });
    let state = editFromRanges(IN_FORCE);
    state = setEditField(setEditField(state, "calories", "min", "2000"), "calories", "max", "1800");
    const outcome = await sendRange(api, "calories", state.fields.calories);
    state = applyOutcome(state, "calories", outcome);
    expect(calls).toEqual([{ nutrient: "calories", input: { minimum: 2000, maximum: 1800 } }]);
    expect(state.errors).toEqual({ calories: "range_inverted" });
    expect(state.fields.calories).toEqual({ min: "2000", max: "1800" });
    expect(state.ranges.calories).toEqual(IN_FORCE.calories);
  });

  // cites: REQ-009/AC-003, R-011
  it("sends a missing maximum as null and shows values_missing next to protein only", async () => {
    const { api, calls } = fakeApi({ kind: "values_missing" });
    let state = setEditField(editFromRanges(IN_FORCE), "protein", "max", "");
    state = setEditField(state, "protein", "min", "80");
    state = applyOutcome(state, "protein", await sendRange(api, "protein", state.fields.protein));
    expect(calls[0]?.input).toEqual({ minimum: 80, maximum: null });
    expect(state.errors).toEqual({ protein: "values_missing" });
    expect(state.ranges.protein).toEqual(IN_FORCE.protein);
  });

  // cites: REQ-009/AC-004, R-011
  it("accepts a minimum equal to the maximum", async () => {
    const saved = range("fat", 70, 70, "2026-01-05");
    const { api, calls } = fakeApi({ kind: "ok", range: saved });
    const outcome = await sendRange(api, "fat", { min: "70", max: "70" });
    expect(calls[0]?.input).toEqual({ minimum: 70, maximum: 70 });
    expect(outcome).toEqual({ kind: "saved", range: saved });
    expect(applyOutcome(editFromRanges(IN_FORCE), "fat", outcome).errors).toEqual({});
  });

  // cites: REQ-009/AC-005, INT-002#T7/T8
  it("shows the new range with the effective_from the server returns, and sends no date", async () => {
    const saved = range("calories", 1900, 2300, "2026-01-05");
    const { api, calls } = fakeApi({ kind: "ok", range: saved });
    let state = setEditField(editFromRanges(IN_FORCE), "calories", "min", "1900");
    state = setEditField(state, "calories", "max", "2300");
    state = applyOutcome(state, "calories", await sendRange(api, "calories", state.fields.calories));
    expect(calls).toEqual([{ nutrient: "calories", input: { minimum: 1900, maximum: 2300 } }]);
    expect(state.ranges.calories).toEqual(saved);
    expect(state.ranges.calories?.effective_from).toBe("2026-01-05");
  });

  // cites: REQ-009/AC-006, INT-002#T11/T12
  it("changes only the named nutrient and leaves the other ranges and their effective_from as they were", async () => {
    const saved = range("calories", 1900, 2300, "2026-01-05");
    const state = applyOutcome(editFromRanges(IN_FORCE), "calories", { kind: "saved", range: saved });
    expect(state.ranges.protein).toEqual(IN_FORCE.protein);
    expect(state.ranges.fat).toEqual(IN_FORCE.fat);
  });

  // cites: REQ-009/AC-009, R-011
  it("sends a minimum of 0 as the number 0, not as missing", async () => {
    const saved = range("calories", 0, 2200, "2026-01-05");
    const { api, calls } = fakeApi({ kind: "ok", range: saved });
    const outcome = await sendRange(api, "calories", { min: "0", max: "2200" });
    expect(calls[0]?.input).toEqual({ minimum: 0, maximum: 2200 });
    expect(outcome.kind).toBe("saved");
  });

  // cites: REQ-009/AC-010, R-011
  it("shows value_invalid for -1 and keeps the range in force, the server deciding", async () => {
    const { api, calls } = fakeApi({ kind: "value_invalid", invalid: ["minimum"] });
    let state = setEditField(editFromRanges(IN_FORCE), "calories", "min", "-1");
    state = applyOutcome(state, "calories", await sendRange(api, "calories", state.fields.calories));
    expect(calls[0]?.input).toEqual({ minimum: -1, maximum: 2200 });
    expect(state.errors).toEqual({ calories: "value_invalid" });
    expect(state.fields.calories.min).toBe("-1");
    expect(state.ranges.calories).toEqual(IN_FORCE.calories);
  });

  // cites: REQ-009/AC-010, R-011
  it("sends a decimal limit as typed and shows the server's refusal", async () => {
    const { api, calls } = fakeApi({ kind: "value_invalid", invalid: ["maximum"] });
    const outcome = await sendRange(api, "calories", { min: "1800", max: "1800.5" });
    expect(calls[0]?.input).toEqual({ minimum: 1800, maximum: 1800.5 });
    expect(outcome).toEqual({ kind: "refused", error: "value_invalid" });
  });

  // cites: REQ-009/AC-010, R-011
  it("does not send text that is no number", async () => {
    const { api, calls } = fakeApi({ kind: "ok", range: range("fat", 1, 2, "2026-01-05") });
    const outcome = await sendRange(api, "fat", { min: "abc", max: "70" });
    expect(calls).toEqual([]);
    expect(outcome).toEqual({ kind: "refused", error: "value_invalid" });
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("reports unauthorized without changing the state", async () => {
    const outcome = await sendRange(fakeApi({ kind: "unauthorized" }).api, "fat", { min: "1", max: "2" });
    const state = editFromRanges(IN_FORCE);
    expect(outcome).toEqual({ kind: "unauthorized" });
    expect(applyOutcome(state, "fat", outcome)).toBe(state);
  });
});
