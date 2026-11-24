import { describe, expect, it } from "vitest";
import { createApi, type FetchLike, type Product } from "./api";
import {
  deleteOutcome,
  filterProducts,
  restoreOutcome,
  screenAfterList,
  sortByName,
} from "./flow";

const P: Product = { id: "p-1", name: "Product A", shop: "Shop A", calories: 120, protein: 5, fat: 3, source: "manual" };

function fake(status: number, body: unknown) {
  const calls: { url: string; method: string | undefined }[] = [];
  const fn: FetchLike = async (input, init) => {
    calls.push({ url: input, method: init?.method });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fn, calls };
}

const apiOf = (fn: FetchLike) => createApi(fn, () => "test-run");

describe("catalog api", () => {
  // cites: REQ-005/AC-005, REQ-005/AC-010
  it("lists the selectable products by default, without asking for deleted ones", async () => {
    const f = fake(200, [{ ...P, selectable: true, deleted: false }]);
    const result = await apiOf(f.fn).listProducts("selectable");
    expect(f.calls).toEqual([{ url: "/products", method: "GET" }]);
    expect(result.kind).toBe("ok");
  });

  // cites: REQ-005/AC-011
  it("asks for the deleted products with state=deleted", async () => {
    const f = fake(200, []);
    await apiOf(f.fn).listProducts("deleted");
    expect(f.calls[0]?.url).toBe("/products?state=deleted");
  });

  // cites: REQ-005/AC-004
  it("deletes with DELETE on the product id", async () => {
    const f = fake(200, { ...P, deleted: true, selectable: false });
    const result = await apiOf(f.fn).deleteProduct("p-1");
    expect(f.calls).toEqual([{ url: "/products/p-1", method: "DELETE" }]);
    expect(result.kind).toBe("ok");
  });

  // cites: REQ-005/AC-011
  it("restores with POST on the restore path", async () => {
    const f = fake(200, { ...P, deleted: false, selectable: true });
    const result = await apiOf(f.fn).restoreProduct("p-1");
    expect(f.calls).toEqual([{ url: "/products/p-1/restore", method: "POST" }]);
    expect(result.kind).toBe("ok");
  });

  // cites: REQ-005/AC-015
  it("reports a duplicate name and shop on restore", async () => {
    const f = fake(409, { code: "product.duplicate_name_shop", message: "exists" });
    expect((await apiOf(f.fn).restoreProduct("p-1")).kind).toBe("duplicate");
  });

  // cites: IF-001@1.2.0#restoreProduct
  it("reports product.not_selectable on a 409", async () => {
    const f = fake(409, { code: "product.not_selectable", message: "replaced" });
    expect((await apiOf(f.fn).deleteProduct("p-1")).kind).toBe("not_selectable");
  });

  // cites: IF-001@1.2.0#listProducts
  it("reports a 401 as unauthorized", async () => {
    const f = fake(401, { code: "auth.required", message: "login" });
    expect((await apiOf(f.fn).listProducts("selectable")).kind).toBe("unauthorized");
  });
});

describe("catalog flow", () => {
  // cites: IF-001@1.2.0#listProducts
  it("orders the list by name then shop, ignoring letter case", () => {
    const a = { ...P, id: "a", name: "banana", shop: "Z" };
    const b = { ...P, id: "b", name: "Apple", shop: "Z" };
    const c = { ...P, id: "c", name: "apple", shop: "A" };
    expect(sortByName([a, b, c]).map((p) => p.id)).toEqual(["c", "b", "a"]);
  });

  // characterization: the ticket text is the only source of the filter
  it("filters the list by name or shop, ignoring case", () => {
    const a = { ...P, id: "a", name: "Oat milk", shop: "Shop A" };
    const b = { ...P, id: "b", name: "Rice", shop: "Corner" };
    expect(filterProducts([a, b], "MILK").map((p) => p.id)).toEqual(["a"]);
    expect(filterProducts([a, b], "corner").map((p) => p.id)).toEqual(["b"]);
    expect(filterProducts([a, b], "  ").length).toBe(2);
  });

  // cites: REQ-005/AC-004
  it("reloads the selectable list after a delete", () => {
    const outcome = deleteOutcome({ kind: "ok", product: P });
    expect(outcome).toEqual({ kind: "reload", view: "selectable", notice: "Product deleted." });
  });

  // cites: IF-001@1.2.0#deleteProduct
  it("says the product changed meanwhile and reloads on not_selectable", () => {
    const outcome = deleteOutcome({ kind: "not_selectable", message: null });
    expect(outcome.kind).toBe("reload");
  });

  // cites: REQ-005/AC-011
  it("reloads the deleted list after a restore", () => {
    const outcome = restoreOutcome({ kind: "ok", product: P });
    expect(outcome).toEqual({ kind: "reload", view: "deleted", notice: "Product restored." });
  });

  // cites: REQ-005/AC-015
  it("keeps the list and says a product with that name and shop already exists", () => {
    const outcome = restoreOutcome({ kind: "duplicate", message: null });
    expect(outcome.kind).toBe("keep");
    expect(outcome.kind === "keep" ? outcome.notice : "").toContain("name and shop already exists");
  });

  // cites: IF-001@1.2.0#restoreProduct
  it("goes back to login on 401 after delete or restore", () => {
    const login = { kind: "screen", screen: { name: "login", error: null } };
    expect(deleteOutcome({ kind: "unauthorized" })).toEqual(login);
    expect(restoreOutcome({ kind: "unauthorized" })).toEqual(login);
  });

  // cites: IF-001@1.2.0#listProducts
  it("builds a sorted catalog screen from the list and goes to login on 401", () => {
    const b = { ...P, id: "b", name: "Beans" };
    const a = { ...P, id: "a", name: "Apple" };
    const screen = screenAfterList({ kind: "ok", products: [b, a] }, "selectable", null);
    expect(screen).toEqual({ name: "catalog", view: "selectable", products: [a, b], filter: "", notice: null });
    expect(screenAfterList({ kind: "unauthorized" }, "selectable", null)).toEqual({ name: "login", error: null });
  });
});
