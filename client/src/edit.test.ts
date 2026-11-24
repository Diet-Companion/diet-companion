import { describe, expect, it } from "vitest";
import { createApi, type FetchLike, type Product } from "./api";
import {
  EDIT_CHANGED_TEXT,
  EDIT_DUPLICATE_TEXT,
  SAVED_NEW_VERSION_TEXT,
  SAVED_TEXT,
  buildPatch,
  editOutcome,
  productToValues,
} from "./edit";
import { NUMBER_ERROR, TEXT_ERROR } from "./flow";

const P: Product = {
  id: "p-1",
  name: "Product A",
  shop: "Shop A",
  calories: 100,
  protein: 5,
  fat: 3,
  source: "manual",
};

interface Call {
  url: string;
  init?: RequestInit;
}

function fakeFetch(status: number, body?: unknown) {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fn, calls };
}

const runId = () => "run-test";

describe("buildPatch", () => {
  // cites: REQ-005/AC-001
  it("sends only calories when only calories changed from 100 to 120", () => {
    const values = { ...productToValues(P), calories: "120" };
    expect(buildPatch(P, values)).toEqual({ ok: true, patch: { calories: 120 } });
  });

  // cites: REQ-005/AC-009
  it("sends only the name when only the name changed to Product B", () => {
    const values = { ...productToValues(P), name: "Product B" };
    expect(buildPatch(P, values)).toEqual({ ok: true, patch: { name: "Product B" } });
  });

  // cites: REQ-005/AC-014
  it("sends the new name as typed so the server can refuse a duplicate", () => {
    const values = { ...productToValues(P), name: "product a" };
    expect(buildPatch(P, values)).toEqual({ ok: true, patch: { name: "product a" } });
  });

  // cites: IF-001@1.2.0#editProduct
  it("sends null for a cleared optional field", () => {
    const p: Product = { ...P, brand: "Brand A", carbohydrate: 12.5 };
    const values = { ...productToValues(p), brand: "", carbohydrate: "" };
    expect(buildPatch(p, values)).toEqual({ ok: true, patch: { brand: null, carbohydrate: null } });
  });

  // cites: IF-001@1.2.0#editProduct
  it("shows comma decimals and sends nothing when they are unchanged", () => {
    const p: Product = { ...P, carbohydrate: 12.5 };
    const values = productToValues(p);
    expect(values.carbohydrate).toBe("12,5");
    expect(buildPatch(p, values)).toEqual({ ok: true, patch: {} });
  });

  // cites: IF-001@1.2.0#editProduct
  it("accepts a comma decimal typed by the Owner", () => {
    const values = { ...productToValues(P), fat: "3,5" };
    expect(buildPatch(P, values)).toEqual({ ok: true, patch: { fat: 3.5 } });
  });

  // cites: IF-001@1.2.0#editProduct
  it("marks a blank required field and a bad number", () => {
    const values = { ...productToValues(P), name: " ", calories: "abc" };
    expect(buildPatch(P, values)).toEqual({ ok: false, errors: { name: TEXT_ERROR, calories: NUMBER_ERROR } });
  });
});

describe("editProduct", () => {
  const edited = { ...P, id: "p-2", calories: 120 };

  // cites: REQ-005/AC-001
  it("patches /products/{id} with the changed fields and reads a 201 as versioned", async () => {
    const f = fakeFetch(201, { product: edited, versioned: true, replaced_id: "p-1" });
    const result = await createApi(f.fn, runId).editProduct("p-1", { calories: 120 });
    expect(result).toEqual({ kind: "ok", product: edited, versioned: true });
    expect(f.calls[0]?.url).toBe("/products/p-1");
    expect(f.calls[0]?.init?.method).toBe("PATCH");
    expect(f.calls[0]?.init?.body).toBe(JSON.stringify({ calories: 120 }));
  });

  // cites: REQ-005/AC-009
  it("reads a 200 as an in-place change", async () => {
    const renamed = { ...P, name: "Product B" };
    const f = fakeFetch(200, { product: renamed, versioned: false, replaced_id: null });
    const result = await createApi(f.fn, runId).editProduct("p-1", { name: "Product B" });
    expect(result).toEqual({ kind: "ok", product: renamed, versioned: false });
  });

  // cites: REQ-005/AC-014
  it("reads 409 product.duplicate_name_shop as a duplicate", async () => {
    const f = fakeFetch(409, { code: "product.duplicate_name_shop", message: "Duplicate" });
    const result = await createApi(f.fn, runId).editProduct("p-1", { name: "product a" });
    expect(result).toEqual({ kind: "duplicate", message: "Duplicate" });
  });

  // cites: IF-001@1.2.0#editProduct
  it("reads 409 product.not_selectable, 404, 401, 422 and 400", async () => {
    const api = (status: number, body?: unknown) => createApi(fakeFetch(status, body).fn, runId);
    const notSelectable = await api(409, { code: "product.not_selectable", message: "Old" }).editProduct("p-1", { fat: 1 });
    expect(notSelectable).toEqual({ kind: "not_selectable", message: "Old" });
    const notFound = await api(404, { code: "product.not_found", message: "None" }).editProduct("p-1", { fat: 1 });
    expect(notFound).toEqual({ kind: "not_found" });
    expect(await api(401).editProduct("p-1", { fat: 1 })).toEqual({ kind: "unauthorized" });
    const missing = await api(422, { code: "product.values_missing", missing: ["name"] }).editProduct("p-1", { fat: 1 });
    expect(missing).toEqual({ kind: "values_missing", missing: ["name"] });
    const invalid = await api(400, { code: "product.value_invalid", message: "Bad", invalid: ["calories"] }).editProduct(
      "p-1",
      { fat: 1 },
    );
    expect(invalid).toEqual({ kind: "value_invalid", invalid: ["calories"], message: "Bad" });
  });

  // cites: IF-001@1.2.0#editProduct
  it("reports failed on a network error", async () => {
    const fn: FetchLike = async () => {
      throw new TypeError("offline");
    };
    expect(await createApi(fn, runId).editProduct("p-1", { fat: 1 })).toEqual({ kind: "failed", message: null });
  });
});

describe("editOutcome", () => {
  const values = { ...productToValues(P), name: "product a" };

  // cites: REQ-005/AC-001, REQ-005/AC-013
  it("shows the new version and the new-version message, with no duplicate refusal", () => {
    const next = { ...P, id: "p-2", calories: 120 };
    const out = editOutcome({ kind: "ok", product: next, versioned: true }, values, P);
    expect(out).toEqual({
      kind: "screen",
      screen: { name: "product", product: next, confirmDelete: false, notice: SAVED_NEW_VERSION_TEXT },
    });
    expect(SAVED_NEW_VERSION_TEXT).toBe("Saved as a new version; the old one is kept for past days");
    expect(JSON.stringify(out)).not.toContain("already exists");
  });

  // cites: REQ-005/AC-009
  it("shows Saved and the product after an in-place change", () => {
    const next = { ...P, name: "Product B" };
    const out = editOutcome({ kind: "ok", product: next, versioned: false }, values, P);
    expect(out).toEqual({
      kind: "screen",
      screen: { name: "product", product: next, confirmDelete: false, notice: SAVED_TEXT },
    });
    expect(SAVED_TEXT).toBe("Saved");
  });

  // cites: REQ-005/AC-014
  it("keeps the form filled and says the name and shop already exist", () => {
    const out = editOutcome({ kind: "duplicate", message: null }, values, P);
    expect(out).toEqual({
      kind: "screen",
      screen: { name: "edit", product: P, values, errors: {}, notice: EDIT_DUPLICATE_TEXT },
    });
    expect(EDIT_DUPLICATE_TEXT).toBe("A product with that name and shop already exists");
  });

  // cites: IF-001@1.2.0#editProduct
  it("marks the fields on 422 and 400", () => {
    const missing = editOutcome({ kind: "values_missing", missing: ["name"] }, values, P);
    expect(missing).toEqual({
      kind: "screen",
      screen: { name: "edit", product: P, values, errors: { name: TEXT_ERROR }, notice: null },
    });
    const invalid = editOutcome({ kind: "value_invalid", invalid: ["calories"], message: null }, values, P);
    expect(invalid).toEqual({
      kind: "screen",
      screen: { name: "edit", product: P, values, errors: { calories: NUMBER_ERROR }, notice: null },
    });
  });

  // cites: IF-001@1.2.0#editProduct
  it("reloads the catalog on not_selectable and 404, and goes to login on 401", () => {
    const reload = { kind: "reload", view: "selectable", notice: EDIT_CHANGED_TEXT };
    expect(editOutcome({ kind: "not_selectable", message: null }, values, P)).toEqual(reload);
    expect(editOutcome({ kind: "not_found" }, values, P)).toEqual(reload);
    expect(EDIT_CHANGED_TEXT).toBe("This product changed meanwhile");
    expect(editOutcome({ kind: "unauthorized" }, values, P)).toEqual({
      kind: "screen",
      screen: { name: "login", error: null },
    });
  });
});
