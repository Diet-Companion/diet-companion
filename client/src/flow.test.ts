import { describe, expect, it } from "vitest";
import type { Product } from "./api";
import {
  SIGNED_IN_KEY,
  buildNewProduct,
  clearSignedIn,
  initialScreen,
  markSignedIn,
  parseDecimal,
  screenAfterProduct,
  type KeyValueStorage,
} from "./flow";

function fakeStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const saved: Product = { id: "p-1", name: "Product A", shop: "Shop A", calories: 120, protein: 5, fat: 3, source: "label" };

describe("screen after each response", () => {
  // cites: REQ-003/AC-010
  it("shows the saved screen on a saved product", () => {
    expect(screenAfterProduct({ kind: "saved", product: saved })).toEqual({ name: "saved", product: saved });
  });

  // cites: REQ-003/AC-002, REQ-003/AC-003, REQ-003/AC-004, REQ-003/AC-007, REQ-003/AC-008
  it("asks for exactly the missing fields", () => {
    const screen = screenAfterProduct({
      kind: "values_missing",
      missing: ["shop", "protein"],
      recognised: { name: "Product A", calories: 120, fat: 3 },
    });
    expect(screen).toEqual({
      name: "missing",
      missing: ["shop", "protein"],
      recognised: { name: "Product A", calories: 120, fat: 3 },
    });
  });

  // cites: REQ-003/AC-011, REQ-003/AC-012, REQ-003/AC-013
  it("shows the duplicate screen on a duplicate", () => {
    expect(screenAfterProduct({ kind: "duplicate", message: "Already there" })).toEqual({
      name: "duplicate",
      message: "Already there",
    });
  });

  // cites: REQ-003/AC-010
  it("returns to login on unauthorized and shows failed on a failure", () => {
    expect(screenAfterProduct({ kind: "unauthorized" })).toEqual({ name: "login", error: null });
    expect(screenAfterProduct({ kind: "failed", message: null })).toEqual({ name: "failed", message: null });
  });
});

describe("buildNewProduct", () => {
  const recognised = { name: "Product A", calories: 120, fat: 3 };

  // cites: REQ-003/AC-003
  it("merges recognised and supplied values with source label", () => {
    const r = buildNewProduct(recognised, ["shop", "protein"], { shop: " Shop A ", protein: "5" });
    expect(r).toEqual({
      ok: true,
      product: { name: "Product A", shop: "Shop A", calories: 120, protein: 5, fat: 3, source: "label" },
    });
  });

  // cites: REQ-003/AC-007
  it("accepts a decimal comma and a decimal point", () => {
    const comma = buildNewProduct({ name: "Product A", shop: "Shop A", protein: 5, fat: 3 }, ["calories"], { calories: "12,5" });
    const point = buildNewProduct({ name: "Product A", shop: "Shop A", protein: 5, fat: 3 }, ["calories"], { calories: "12.5" });
    expect(comma.ok && comma.product.calories).toBe(12.5);
    expect(point.ok && point.product.calories).toBe(12.5);
  });

  // cites: REQ-003/AC-008
  it("refuses a negative or non-numeric value and builds nothing", () => {
    const r = buildNewProduct({ name: "Product A", shop: "Shop A", calories: 120, protein: 5 }, ["fat"], { fat: "-1" });
    expect(r.ok).toBe(false);
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("0")).toBe(0);
  });

  // cites: REQ-003/AC-004
  it("refuses an empty name", () => {
    const r = buildNewProduct({ shop: "Shop A", calories: 1, protein: 1, fat: 1 }, ["name"], { name: "  " });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.name).toBeDefined();
  });

  // cites: REQ-003/AC-002
  it("keeps the recognised brand", () => {
    const r = buildNewProduct({ ...recognised, protein: 5, brand: "Brand A" }, ["shop"], { shop: "Shop A" });
    expect(r.ok && r.product.brand).toBe("Brand A");
  });
});

describe("signed-in hint", () => {
  // cites: REQ-003/AC-010
  it("starts on login without the flag and on add with it", () => {
    const s = fakeStorage();
    expect(initialScreen(s)).toEqual({ name: "login", error: null });
    markSignedIn(s);
    expect(s.data.get(SIGNED_IN_KEY)).toBe("1");
    expect(initialScreen(s)).toEqual({ name: "add" });
  });

  // cites: REQ-003/AC-010
  it("clears the flag", () => {
    const s = fakeStorage();
    markSignedIn(s);
    clearSignedIn(s);
    expect(initialScreen(s)).toEqual({ name: "login", error: null });
  });

  // cites: REQ-003/AC-010
  it("behaves as absent when storage throws or is missing", () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(initialScreen(broken)).toEqual({ name: "login", error: null });
    expect(() => markSignedIn(broken)).not.toThrow();
    expect(() => clearSignedIn(broken)).not.toThrow();
    expect(initialScreen(null)).toEqual({ name: "login", error: null });
  });
});
