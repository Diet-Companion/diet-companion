import { describe, expect, it } from "vitest";
import { createApi, type FetchLike, type NewProduct, type Product } from "./api";
import { buildManualProduct, screenAfterManual } from "./flow";

const filled = { name: " Product A ", shop: "Shop A", calories: "120", protein: "5,5", fat: "3" };
const base: NewProduct = { name: "A", shop: "B", calories: 1, protein: 1, fat: 1, source: "manual" };

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fn, calls };
}

const savedBody = {
  id: "p-1",
  name: "Product A",
  shop: "Shop A",
  calories: 120,
  protein: 5.5,
  fat: 3,
  source: "manual",
  salt: 1.15,
  piece_weight: 50,
  sodium: 460,
  counted_by_piece: true,
};

describe("hand-entry request", () => {
  // cites: REQ-002/AC-001, REQ-002/AC-004
  it("sends only the filled fields with source manual and accepts a decimal comma", async () => {
    const built = buildManualProduct({ ...filled, brand: "  ", salt: "" });
    expect(built).toEqual({
      ok: true,
      product: { name: "Product A", shop: "Shop A", calories: 120, protein: 5.5, fat: 3, source: "manual" },
    });
    const { fn, calls } = fakeFetch(201, savedBody);
    if (!built.ok) throw new Error("not built");
    await createApi(fn, () => "run-1").createProduct(built.product);
    expect(calls[0]?.url).toBe("/products");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(built.product);
  });

  // cites: REQ-002/AC-008, REQ-002/AC-009
  it("sends piece weight and portion values when filled", () => {
    const built = buildManualProduct({ ...filled, piece_weight: "50", portion_size: "10", portion_calories: "37.7" });
    expect(built.ok && built.product.piece_weight).toBe(50);
    expect(built.ok && built.product.portion_size).toBe(10);
    expect(built.ok && built.product.portion_calories).toBe(37.7);
  });

  // cites: REQ-002/AC-002, REQ-002/AC-003, REQ-002/AC-014, REQ-002/AC-018, REQ-002/AC-019
  it("marks each empty required field", () => {
    const r = buildManualProduct({});
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["calories", "fat", "name", "protein", "shop"]);
    const noProtein = buildManualProduct({ ...filled, protein: "" });
    expect(!noProtein.ok && Object.keys(noProtein.errors)).toEqual(["protein"]);
  });

  // cites: REQ-002/AC-001
  it("refuses a negative number in the client", () => {
    const r = buildManualProduct({ ...filled, sugars: "-1" });
    expect(!r.ok && r.errors.sugars).toBeDefined();
  });
});

describe("hand-entry responses", () => {
  const values = { ...filled };

  // cites: REQ-002/AC-005, REQ-002/AC-008
  it("parses sodium and counted_by_piece from a 201 into the saved screen", async () => {
    const { fn } = fakeFetch(201, savedBody);
    const result = await createApi(fn, () => "run-1").createProduct(base);
    expect(result.kind).toBe("saved");
    const screen = screenAfterManual(result, values);
    expect(screen.name).toBe("saved");
    const p = (screen as { product: Product }).product;
    expect(p.sodium).toBe(460);
    expect(p.counted_by_piece).toBe(true);
    expect(p.piece_weight).toBe(50);
  });

  // cites: REQ-002/AC-002, REQ-002/AC-003, REQ-002/AC-014, REQ-002/AC-018, REQ-002/AC-019
  it("marks the fields a 422 lists and keeps the values", async () => {
    const { fn } = fakeFetch(422, { code: "product.values_missing", missing: ["calories", "fat"], recognised: {} });
    const result = await createApi(fn, () => "r").createProduct(base);
    const screen = screenAfterManual(result, values);
    expect(screen).toMatchObject({ name: "manual", values });
    expect(screen.name === "manual" && Object.keys(screen.errors).sort()).toEqual(["calories", "fat"]);
  });

  // cites: REQ-002/AC-001
  it("marks the fields a 400 value_invalid lists", async () => {
    const { fn } = fakeFetch(400, { code: "product.value_invalid", message: "neg", invalid: ["salt", "bogus"] });
    const result = await createApi(fn, () => "r").createProduct(base);
    expect(result.kind).toBe("value_invalid");
    const screen = screenAfterManual(result, values);
    expect(screen.name === "manual" && Object.keys(screen.errors)).toEqual(["salt"]);
  });

  // cites: REQ-002/AC-015, REQ-002/AC-017
  it("says the name and shop already exist on a 409 and keeps the form filled", async () => {
    const { fn } = fakeFetch(409, { code: "product.duplicate_name_shop", message: "dup" });
    const result = await createApi(fn, () => "r").createProduct(base);
    const screen = screenAfterManual(result, values);
    expect(screen).toMatchObject({ name: "manual", values });
    expect(screen.name === "manual" && screen.notice).toContain("name and shop already exists");
  });

  // cites: REQ-002/AC-016
  it("shows the saved screen when the same name is saved in another shop", () => {
    const product: Product = { ...base, id: "p-2", shop: "Shop B" };
    expect(screenAfterManual({ kind: "saved", product }, values)).toEqual({ name: "saved", product });
  });

  // cites: REQ-002/AC-001
  it("goes back to login on 401", () => {
    expect(screenAfterManual({ kind: "unauthorized" }, values)).toEqual({ name: "login", error: null });
  });
});
