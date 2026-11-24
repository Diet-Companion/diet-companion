// Seed examples for the API layer (S-QA-004): each test drives the real backend in-process against PostgreSQL
// and asserts only what IF-001 and the cited sources state (S-QA-006). test-gen-api adds more files here.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newProduct, startApi, type Api } from "./support/api.js";

let api: Api;

beforeAll(async () => {
  api = await startApi();
  await api.login();
});

afterAll(async () => {
  await api.close();
});

describe("catalog API", () => {
  // cites: REQ-002/AC-001, IF-001@1.3.0#createProduct
  it("saves a product with name, shop, calories, protein and fat", async () => {
    const res = await api.request("POST", "/products", newProduct({ name: "Seed Oats" }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: "Seed Oats", shop: "Shop A", calories: 100, protein: 10, fat: 5 });
  });

  // cites: REQ-002/AC-005, R-001
  it("computes sodium as salt x 400", async () => {
    const res = await api.request("POST", "/products", newProduct({ salt: 1.5 }));
    expect(res.statusCode).toBe(201);
    expect(res.json().sodium).toBe(600);
  });

  // cites: REQ-005/AC-001, R-004, IF-001@1.3.0#editProduct
  it("records a new product when calories change, and keeps the old one", async () => {
    const created = (await api.request("POST", "/products", newProduct({ calories: 100 }))).json();
    const res = await api.request("PATCH", `/products/${created.id}`, { calories: 120 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ versioned: true, replaced_id: created.id, product: { calories: 120 } });
    const old = (await api.request("GET", `/products/${created.id}`)).json();
    expect(old).toMatchObject({ calories: 100, selectable: false });
  });

  // cites: ADR-004/C-005, IF-001@1.3.0#listProducts
  it("refuses the catalog without a session", async () => {
    api.logout();
    try {
      const res = await api.request("GET", "/products");
      expect(res.statusCode).toBe(401);
    } finally {
      await api.login();
    }
  });
});
