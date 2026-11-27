import { describe, expect, it } from "vitest";
import type { DishStore } from "./dish-store.js";
import type { StoredEntry } from "./plan-store.js";
import type { ProductStore } from "./products.js";
import {
  buildResult,
  compareToRange,
  entryValues,
  roundTotal,
  toMealTotals,
  totalsOfEntries,
  type TotalsDeps,
} from "./totals.js";

const RANGE = { minimum: 1800, maximum: 2200 };

const cal = (total: number) => compareToRange("calories", total, RANGE);

// Synthetic products, per 100 g. "rice" has a piece weight of 50 g.
const PRODUCTS: Record<string, { calories: number; protein: number; fat: number; piece_weight: number | null }> = {
  rice: { calories: 200, protein: 10, fat: 2, piece_weight: 50 },
  oil: { calories: 800, protein: 0, fat: 90, piece_weight: null },
};

const DISHES: Record<string, { lines: { product_id: string; grams: number | null; pieces: number | null }[] }> = {
  bowl: {
    lines: [
      { product_id: "rice", grams: 100, pieces: null },
      { product_id: "oil", grams: 10, pieces: null },
    ],
  },
};

const deps = {
  products: {
    get: async (id: string) => (PRODUCTS[id] ? { product: { id, ...PRODUCTS[id] } } : undefined),
  } as unknown as ProductStore,
  dishes: {
    get: async (id: string) => (DISHES[id] ? { dish: { id, name: id, ...DISHES[id] } } : undefined),
  } as unknown as DishStore,
} as unknown as TotalsDeps;

const entry = (over: Partial<StoredEntry>): StoredEntry => ({
  id: "e1",
  meal: "lunch",
  position: 0,
  product_id: null,
  dish_id: null,
  grams: null,
  pieces: null,
  from_dish_id: null,
  ...over,
});

describe("rounding", () => {
  it("cites: REQ-010/AC-012 a halfway total of 99.5 rounds up to 100", () => {
    expect(roundTotal(99.5)).toBe(100);
    expect(cal(99.5).total).toBe(100);
  });

  it("cites: REQ-010/AC-025 an unrounded 1799.6 is 1800 and the check uses 1800", () => {
    const result = cal(1799.6);
    expect(result.total).toBe(1800);
    expect(result.status).toBe("green");
    expect(result.signed_number).toBe("-400");
  });

  it("cites: REQ-010/AC-025 floating point noise is normalised before rounding", () => {
    expect(roundTotal(0.1 + 0.2 + 99.2)).toBe(100);
  });
});

describe("comparison with a range", () => {
  it("cites: REQ-010/AC-017 1500 is yellow with -300", () => {
    const result = cal(1500);
    expect(result.status).toBe("yellow");
    expect(result.signed_number).toBe("-300");
  });

  it("cites: REQ-010/AC-018 2500 is red with +300", () => {
    const result = cal(2500);
    expect(result.status).toBe("red");
    expect(result.signed_number).toBe("+300");
  });

  it("cites: REQ-010/AC-019 2000 is green with -200", () => {
    const result = cal(2000);
    expect(result.status).toBe("green");
    expect(result.signed_number).toBe("-200");
  });

  it("cites: REQ-010/AC-020 exactly 1800 is green with -400", () => {
    const result = cal(1800);
    expect(result.status).toBe("green");
    expect(result.signed_number).toBe("-400");
  });

  it("cites: REQ-010/AC-021 exactly 2200 is green with 0 and no sign", () => {
    const result = cal(2200);
    expect(result.status).toBe("green");
    expect(result.signed_number).toBe("0");
  });

  it("cites: REQ-010/AC-022 2190 is plain green with -10 and no other state", () => {
    const result = cal(2190);
    expect(result.status).toBe("green");
    expect(result.signed_number).toBe("-10");
  });

  it("cites: REQ-010/AC-026 1799 is yellow with -1", () => {
    const result = cal(1799);
    expect(result.status).toBe("yellow");
    expect(result.signed_number).toBe("-1");
  });

  it("cites: REQ-010/AC-027 2201 is red with +1", () => {
    const result = cal(2201);
    expect(result.status).toBe("red");
    expect(result.signed_number).toBe("+1");
  });

  it("cites: REQ-010/AC-028 2199 is green with -1, not +1 and not 0", () => {
    const result = cal(2199);
    expect(result.status).toBe("green");
    expect(result.signed_number).toBe("-1");
  });

  it("cites: REQ-010/AC-017 a nutrient with no range is no_range with a null number", () => {
    const result = compareToRange("protein", 80, undefined);
    expect(result.status).toBe("no_range");
    expect(result.signed_number).toBeNull();
    expect(result.minimum).toBeNull();
    expect(result.maximum).toBeNull();
  });

  it("cites: REQ-010/AC-017 buildResult lists calories, protein, fat and keeps the source", () => {
    const result = buildResult({ calories: 1500, protein: 50, fat: 40 }, "closed_copy", [
      { nutrient: "calories", ...RANGE },
    ]);
    expect(result.ranges_source).toBe("closed_copy");
    expect(result.nutrients.map((n) => n.nutrient)).toEqual(["calories", "protein", "fat"]);
    expect(result.nutrients[0]?.status).toBe("yellow");
    expect(result.nutrients[1]?.status).toBe("no_range");
    expect(result.nutrients[2]?.status).toBe("no_range");
  });
});

describe("meal totals", () => {
  it("cites: REQ-010/AC-013, REQ-015/AC-010 meal totals are whole numbers with no range or colour", () => {
    const totals = toMealTotals({ calories: 99.5, protein: 10.4, fat: 3.6 });
    expect(totals).toEqual({ calories: 100, protein: 10, fat: 4 });
    expect(Object.keys(totals).sort()).toEqual(["calories", "fat", "protein"]);
  });
});

describe("entry values", () => {
  it("cites: REQ-010/AC-012 a product entry in grams is the per-100 g value times grams over 100", async () => {
    const values = await entryValues(deps, entry({ product_id: "rice", grams: 150 }));
    expect(values).toEqual({ calories: 300, protein: 15, fat: 3 });
  });

  it("cites: REQ-010/AC-012 a pieces entry weighs pieces times the piece weight of its product", async () => {
    const values = await entryValues(deps, entry({ product_id: "rice", pieces: 3 }));
    expect(values).toEqual({ calories: 300, protein: 15, fat: 3 });
  });

  it("cites: REQ-010/AC-012 a dish entry is the sum of its dish lines", async () => {
    const values = await entryValues(deps, entry({ dish_id: "bowl" }));
    expect(values).toEqual({ calories: 280, protein: 10, fat: 11 });
  });

  it("cites: REQ-010/AC-025 totals of entries sum the unrounded values before rounding", async () => {
    const entries = [
      entry({ id: "a", product_id: "rice", grams: 0.25 }),
      entry({ id: "b", product_id: "rice", grams: 0.25 }),
    ];
    const totals = await totalsOfEntries(deps, entries);
    expect(totals.calories).toBeCloseTo(1, 6);
    expect(compareToRange("calories", totals.calories, undefined).total).toBe(1);
  });

  it("cites: REQ-010/AC-012 an entry naming an unknown product is refused", async () => {
    await expect(entryValues(deps, entry({ product_id: "nope", grams: 10 }))).rejects.toThrow();
  });
});
