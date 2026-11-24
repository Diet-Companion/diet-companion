import { describe, expect, it } from "vitest";
import { toProductResponse, type Product } from "./products.js";

const base: Product = { id: "p-1", name: "Product A", shop: "Shop A", calories: 100, protein: 5, fat: 3, source: "manual" };

describe("sodium on read", () => {
  // cites: R-001
  it("rounds sodium to 2 decimals so salt 1.15 g gives 460 mg", () => {
    expect(toProductResponse({ ...base, salt: 1.15 }).sodium).toBe(460);
  });

  // cites: R-001, REQ-002/AC-005
  it("gives 600 mg for salt 1.5 g", () => {
    expect(toProductResponse({ ...base, salt: 1.5 }).sodium).toBe(600);
  });

  // cites: R-001, REQ-002/AC-011
  it("gives 0 mg when salt is empty", () => {
    expect(toProductResponse(base).sodium).toBe(0);
  });
});
