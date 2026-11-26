// API tests for REQ-002: the product record and its validation (S-QA-004). Each test drives the real backend
// in-process and asserts only what the cited AC, rule or IF-001@1.3.0 state (S-QA-006). The lifecycle (edit,
// delete, restore) is covered in product-lifecycle.api.test.ts and is not repeated here.
import { randomUUID } from "node:crypto";
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

const uid = (): string => randomUUID().slice(0, 8);

/** A product body with a unique name and shop, so no test meets another test's data (R-003). */
function fresh(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = uid();
  return newProduct({ name: `Rec ${id}`, shop: `Shop ${id}`, ...overrides });
}

/** A body with one field left out. */
function without(field: string): Record<string, unknown> {
  const body = fresh();
  delete body[field];
  return body;
}

async function listedNames(): Promise<string[]> {
  const res = await api.request("GET", "/products");
  return (res.json() as Array<{ name: string }>).map((p) => p.name);
}

describe("product record: required values (R-002)", () => {
  // cites: REQ-002/AC-001, R-002, IF-001@1.3.0#createProduct, IF-001@1.3.0#getProduct
  it("saves a product with name, shop, calories, protein and fat, and reads it back", async () => {
    const body = fresh({ calories: 250, protein: 12, fat: 7 });
    const res = await api.request("POST", "/products", body);
    expect(res.statusCode).toBe(201);
    const saved = res.json();
    expect(saved).toMatchObject({ calories: 250, protein: 12, fat: 7 });
    const read = await api.request("GET", `/products/${saved.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ calories: 250, protein: 12, fat: 7, selectable: true });
  });

  // cites: REQ-002/AC-002, R-002, IF-001@1.3.0#createProduct
  it("refuses a product without calories and reports calories as missing", async () => {
    const body = without("calories");
    const res = await api.request("POST", "/products", body);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("product.values_missing");
    expect(res.json().missing).toEqual(["calories"]);
    expect(await listedNames()).not.toContain(body.name);
  });

  // cites: REQ-002/AC-003, R-002, IF-001@1.3.0#createProduct
  it("refuses a product without a shop and reports shop as missing", async () => {
    const body = without("shop");
    const res = await api.request("POST", "/products", body);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("product.values_missing");
    expect(res.json().missing).toEqual(["shop"]);
    expect(await listedNames()).not.toContain(body.name);
  });

  // cites: REQ-002/AC-014, R-002, IF-001@1.3.0#createProduct
  it("refuses a product without a name and reports name as missing", async () => {
    const res = await api.request("POST", "/products", without("name"));
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("product.values_missing");
    expect(res.json().missing).toEqual(["name"]);
  });

  // cites: REQ-002/AC-018, R-002, IF-001@1.3.0#createProduct
  it("refuses a product without protein and reports protein as missing", async () => {
    const body = without("protein");
    const res = await api.request("POST", "/products", body);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("product.values_missing");
    expect(res.json().missing).toEqual(["protein"]);
    expect(await listedNames()).not.toContain(body.name);
  });

  // cites: REQ-002/AC-019, R-002, IF-001@1.3.0#createProduct
  it("refuses a product without fat and reports fat as missing", async () => {
    const body = without("fat");
    const res = await api.request("POST", "/products", body);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("product.values_missing");
    expect(res.json().missing).toEqual(["fat"]);
    expect(await listedNames()).not.toContain(body.name);
  });

  // cites: REQ-002/AC-002, REQ-002/AC-003, REQ-002/AC-014, REQ-002/AC-018, REQ-002/AC-019, R-002, IF-001@1.3.0#createProduct
  it("lists every missing required value when several are missing", async () => {
    const res = await api.request("POST", "/products", { source: "manual" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("product.values_missing");
    expect(res.json().missing).toHaveLength(5);
    expect(res.json().missing).toEqual(expect.arrayContaining(["name", "shop", "calories", "protein", "fat"]));
  });

  // cites: REQ-002/AC-004, R-002, IF-001@1.3.0#createProduct, IF-001@1.3.0#getProduct
  it("saves a product with carbohydrate, sugars, fibre, salt and brand empty", async () => {
    const res = await api.request("POST", "/products", fresh());
    expect(res.statusCode).toBe(201);
    const read = (await api.request("GET", `/products/${res.json().id}`)).json();
    for (const field of ["carbohydrate", "sugars", "fibre", "salt", "brand"]) {
      expect(read[field] ?? null).toBe(null);
    }
  });
});

describe("product record: sodium is computed (R-001)", () => {
  // cites: REQ-002/AC-005, R-001, IF-001@1.3.0#createProduct
  it("computes sodium 600 mg from salt 1.5 g", async () => {
    const res = await api.request("POST", "/products", fresh({ salt: 1.5 }));
    expect(res.statusCode).toBe(201);
    expect(res.json().sodium).toBe(600);
  });

  // cites: REQ-002/AC-005, R-001, IF-001@1.3.0#getProduct
  it("returns the computed sodium when the product is read", async () => {
    const created = (await api.request("POST", "/products", fresh({ salt: 1.5 }))).json();
    const read = await api.request("GET", `/products/${created.id}`);
    expect(read.json().sodium).toBe(600);
  });

  // cites: REQ-002/AC-006, R-001, IF-001@1.3.0#createProduct
  it("gives sodium 0 when salt is 0", async () => {
    const res = await api.request("POST", "/products", fresh({ salt: 0 }));
    expect(res.statusCode).toBe(201);
    expect(res.json().sodium).toBe(0);
  });

  // cites: REQ-002/AC-011, R-001, IF-001@1.3.0#createProduct
  it("gives sodium 0 when salt is empty", async () => {
    const res = await api.request("POST", "/products", fresh());
    expect(res.statusCode).toBe(201);
    expect(res.json().sodium).toBe(0);
  });

  // cites: REQ-002/AC-005, R-001, IF-001@1.3.0#createProduct
  it("ignores a sodium value sent with salt", async () => {
    const res = await api.request("POST", "/products", fresh({ salt: 1.5, sodium: 9999 }));
    expect(res.statusCode).toBe(201);
    expect(res.json().sodium).toBe(600);
  });

  // cites: REQ-002/AC-011, R-001, IF-001@1.3.0#createProduct
  it("ignores a sodium value sent without salt", async () => {
    const res = await api.request("POST", "/products", fresh({ sodium: 9999 }));
    expect(res.statusCode).toBe(201);
    expect(res.json().sodium).toBe(0);
  });
});

describe("product record: piece weight and portion example", () => {
  // cites: REQ-002/AC-008, R-003, IF-001@1.3.0#createProduct
  it("stores 50 g as the weight of one piece and counts the product by the piece", async () => {
    const res = await api.request("POST", "/products", fresh({ piece_weight: 50 }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ piece_weight: 50, counted_by_piece: true });
  });

  // cites: REQ-002/AC-008, R-003, IF-001@1.3.0#getProduct
  it("keeps the piece weight and counted_by_piece when the product is read", async () => {
    const created = (await api.request("POST", "/products", fresh({ piece_weight: 50 }))).json();
    const read = await api.request("GET", `/products/${created.id}`);
    expect(read.json()).toMatchObject({ piece_weight: 50, counted_by_piece: true });
  });

  // cites: REQ-002/AC-012, R-003, IF-001@1.3.0#createProduct
  it("saves a product with no piece weight and does not count it by the piece", async () => {
    const res = await api.request("POST", "/products", fresh());
    expect(res.statusCode).toBe(201);
    expect(res.json().counted_by_piece).toBe(false);
  });

  // cites: REQ-002/AC-012, R-003, IF-001@1.3.0#NewProduct
  it("stores a piece weight of 0 as empty and does not count the product by the piece", async () => {
    const res = await api.request("POST", "/products", fresh({ piece_weight: 0 }));
    expect(res.statusCode).toBe(201);
    expect(res.json().counted_by_piece).toBe(false);
    expect(res.json().piece_weight ?? null).toBe(null);
  });

  // cites: REQ-002/AC-009, IF-001@1.3.0#createProduct, IF-001@1.3.0#getProduct
  it("stores portion size 10 g and portion calories 37.7", async () => {
    const created = await api.request("POST", "/products", fresh({ portion_size: 10, portion_calories: 37.7 }));
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ portion_size: 10, portion_calories: 37.7 });
    const read = await api.request("GET", `/products/${created.json().id}`);
    expect(read.json()).toMatchObject({ portion_size: 10, portion_calories: 37.7 });
  });

  // cites: REQ-002/AC-009, IF-001@1.3.0#NewProduct
  it("stores a portion size and portion calories of 0 as empty", async () => {
    const res = await api.request("POST", "/products", fresh({ portion_size: 0, portion_calories: 0 }));
    expect(res.statusCode).toBe(201);
    expect(res.json().portion_size ?? null).toBe(null);
    expect(res.json().portion_calories ?? null).toBe(null);
  });
});

describe("product record: per 100 ml values", () => {
  // cites: REQ-002/AC-007, IF-001@1.3.0#NewProduct
  it("stores a per-100 ml label value as the same number per 100 g", async () => {
    const created = await api.request("POST", "/products", fresh({ calories: 42, carbohydrate: 9.5 }));
    expect(created.statusCode).toBe(201);
    const read = await api.request("GET", `/products/${created.json().id}`);
    expect(read.json()).toMatchObject({ calories: 42, carbohydrate: 9.5 });
  });
});

describe("product record: negative values", () => {
  // cites: IF-001@1.3.0#createProduct
  it("refuses a negative calories value with product.value_invalid listing calories", async () => {
    const body = fresh({ calories: -1 });
    const res = await api.request("POST", "/products", body);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("product.value_invalid");
    expect(res.json().invalid).toEqual(["calories"]);
    expect(await listedNames()).not.toContain(body.name);
  });

  // cites: IF-001@1.3.0#createProduct
  it("lists every negative field in product.value_invalid", async () => {
    const res = await api.request("POST", "/products", fresh({ protein: -2, salt: -0.5, piece_weight: -3 }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("product.value_invalid");
    expect(res.json().invalid).toHaveLength(3);
    expect(res.json().invalid).toEqual(expect.arrayContaining(["protein", "salt", "piece_weight"]));
  });

  // cites: IF-001@1.3.0#createProduct
  it("accepts a value of 0 as a required nutrient value", async () => {
    const res = await api.request("POST", "/products", fresh({ calories: 0, protein: 0, fat: 0 }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ calories: 0, protein: 0, fat: 0 });
  });
});

describe("product record: same name and shop (R-003)", () => {
  // cites: REQ-002/AC-015, R-003, IF-001@1.3.0#createProduct
  it("refuses the same name and shop with another brand", async () => {
    const first = fresh({ brand: "Brand A" });
    expect((await api.request("POST", "/products", first)).statusCode).toBe(201);
    const res = await api.request("POST", "/products", { ...first, brand: "Brand B" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.duplicate_name_shop");
  });

  // cites: REQ-002/AC-016, R-003, IF-001@1.3.0#createProduct
  it("saves the same name in another shop", async () => {
    const first = fresh();
    expect((await api.request("POST", "/products", first)).statusCode).toBe(201);
    const res = await api.request("POST", "/products", { ...first, shop: `Other ${uid()}` });
    expect(res.statusCode).toBe(201);
  });

  // cites: REQ-002/AC-017, R-003, IF-001@1.3.0#createProduct
  it("refuses the same name and shop ignoring letter case and extra spaces", async () => {
    const first = fresh();
    expect((await api.request("POST", "/products", first)).statusCode).toBe(201);
    const spaced = (text: unknown): string => `  ${String(text).toLowerCase().replace(" ", "   ")}  `;
    const res = await api.request("POST", "/products", {
      ...first,
      name: spaced(first.name),
      shop: spaced(first.shop),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.duplicate_name_shop");
  });
});
