import { describe, expect, it } from "vitest";
import type { FetchLike } from "./api";
import { createTargetsApi } from "./targetsApi";

function fake(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { api: createTargetsApi(fn, () => "run-1"), calls };
}

const CALORIES = { nutrient: "calories", minimum: 1800, maximum: 2200, unit: "kcal", effective_from: "2026-01-05" };

describe("targets api", () => {
  // cites: IF-001@1.4.0#getTargetRanges
  it("reads the ranges with a null for a nutrient with no range", async () => {
    const { api, calls } = fake(200, {
      as_of: "2026-01-05",
      setup_complete: false,
      calories: CALORIES,
      protein: null,
      fat: null,
    });
    const result = await api.getTargetRanges();
    expect(calls[0]?.url).toBe("/target-ranges");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(result).toEqual({
      kind: "ok",
      ranges: { as_of: "2026-01-05", setup_complete: false, calories: CALORIES, protein: null, fat: null },
    });
  });

  // cites: IF-001@1.4.0#getTargetRanges
  it("answers unauthorized on 401 when reading", async () => {
    const { api } = fake(401, { code: "auth.required", message: "x" });
    expect(await api.getTargetRanges()).toEqual({ kind: "unauthorized" });
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("puts one nutrient with its minimum and maximum", async () => {
    const { api, calls } = fake(200, CALORIES);
    const result = await api.setTargetRange("calories", { minimum: 1800, maximum: 2200 });
    expect(calls[0]?.url).toBe("/target-ranges/calories");
    expect(calls[0]?.init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ minimum: 1800, maximum: 2200 });
    expect(result).toEqual({ kind: "ok", range: CALORIES });
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("maps target.range_inverted on 400", async () => {
    const { api } = fake(400, { code: "target.range_inverted", message: "x", invalid: ["minimum", "maximum"] });
    expect(await api.setTargetRange("calories", { minimum: 2000, maximum: 1800 })).toEqual({ kind: "range_inverted" });
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("maps target.value_invalid on 400 with the offending limits", async () => {
    const { api } = fake(400, { code: "target.value_invalid", message: "x", invalid: ["minimum"] });
    expect(await api.setTargetRange("calories", { minimum: -1, maximum: 2200 })).toEqual({
      kind: "value_invalid",
      invalid: ["minimum"],
    });
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("maps target.values_missing on 422", async () => {
    const { api } = fake(422, { code: "target.values_missing", message: "x", missing: ["maximum"] });
    expect(await api.setTargetRange("protein", { minimum: 80, maximum: null })).toEqual({ kind: "values_missing" });
  });

  // cites: IF-001@1.4.0#setTargetRange
  it("answers unauthorized on 401 when saving", async () => {
    const { api } = fake(401, { code: "auth.required", message: "x" });
    expect(await api.setTargetRange("fat", { minimum: 1, maximum: 2 })).toEqual({ kind: "unauthorized" });
  });
});
