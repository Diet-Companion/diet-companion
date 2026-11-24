import { describe, expect, it } from "vitest";
import type { LabelProvider, LabelValues } from "@diet-companion/label-reader";
import { buildApp } from "./app.js";
import { InMemoryProductStore } from "./products.js";

const FULL: LabelValues = {
  name: "Product A",
  shop: "Shop A",
  calories: 250,
  protein: 10,
  fat: 5,
  brand: "Brand X",
};
const PHOTO = "synthetic-label-bytes";

class FakeProvider implements LabelProvider {
  readonly seen: Uint8Array[] = [];
  constructor(private readonly result: LabelValues | Error) {}
  async readLabel(photo: Uint8Array): Promise<LabelValues> {
    this.seen.push(photo);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

function setup(result: LabelValues | Error, owner = true) {
  let n = 0;
  const store = new InMemoryProductStore(() => `id-${++n}`);
  const provider = new FakeProvider(result);
  const app = buildApp({
    store,
    labelProvider: provider,
    isOwner: owner ? () => true : undefined,
  });
  return { app, store, provider };
}

function multipart(content: string, field = "photo") {
  const boundary = "----testboundary";
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="label.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
  return {
    payload: Buffer.from(`${head}${content}\r\n--${boundary}--\r\n`),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function upload(app: ReturnType<typeof setup>["app"], headers: Record<string, string> = {}) {
  const form = multipart(PHOTO);
  return app.inject({
    method: "POST",
    url: "/products/label-photo",
    payload: form.payload,
    headers: { ...form.headers, ...headers },
  });
}

function create(app: ReturnType<typeof setup>["app"], body: unknown) {
  return app.inject({ method: "POST", url: "/products", payload: body as object });
}

async function seedProductA(store: InMemoryProductStore) {
  await store.add({ name: "Product A", shop: "Shop A", calories: 100, protein: 1, fat: 1, source: "manual" });
}

describe("addProductFromLabelPhoto", () => {
  // cites: REQ-003/AC-010
  it("saves the product with source label and asks for no confirmation", async () => {
    const { app, store, provider } = setup(FULL);
    const res = await upload(app);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: "Product A",
      shop: "Shop A",
      calories: 250,
      protein: 10,
      fat: 5,
      source: "label",
    });
    expect(store.list()).toHaveLength(1);
    expect(Buffer.from(provider.seen[0]!).toString()).toBe(PHOTO);
  });

  // cites: REQ-003/AC-005
  it("never stores or returns the photo", async () => {
    const { app, store } = setup(FULL);
    const res = await upload(app);
    expect(res.body).not.toContain(PHOTO);
    expect(JSON.stringify(store.list())).not.toContain(PHOTO);
  });

  // cites: REQ-003/AC-002
  it("asks for the shop when none is recognised, then saves after it is supplied", async () => {
    const { app, store } = setup({ ...FULL, shop: null });
    const res = await upload(app);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("product.values_missing");
    expect(res.json().missing).toEqual(["shop"]);
    expect(res.json().recognised.name).toBe("Product A");
    expect(store.list()).toHaveLength(0);
    const saved = await create(app, { ...res.json().recognised, shop: "Shop A", source: "label" });
    expect(saved.statusCode).toBe(201);
    expect(store.list()).toHaveLength(1);
  });

  // cites: REQ-003/AC-003
  it("asks for protein and saves nothing when protein is not recognised", async () => {
    const { app, store } = setup({ ...FULL, protein: null });
    const res = await upload(app);
    expect(res.statusCode).toBe(422);
    expect(res.json().missing).toEqual(["protein"]);
    expect(store.list()).toHaveLength(0);
  });

  // cites: REQ-003/AC-004
  it("asks for the name when the photo gives none", async () => {
    const { app } = setup({ ...FULL, name: null });
    const res = await upload(app);
    expect(res.statusCode).toBe(422);
    expect(res.json().missing).toEqual(["name"]);
  });

  // cites: REQ-003/AC-007, R-002
  it("asks for calories and saves nothing when calories are not recognised", async () => {
    const { app, store } = setup({ ...FULL, calories: null });
    const res = await upload(app);
    expect(res.statusCode).toBe(422);
    expect(res.json().missing).toEqual(["calories"]);
    expect(store.list()).toHaveLength(0);
  });

  // cites: REQ-003/AC-008, R-002
  it("asks for fat and saves nothing when fat is not recognised", async () => {
    const { app, store } = setup({ ...FULL, fat: null });
    const res = await upload(app);
    expect(res.statusCode).toBe(422);
    expect(res.json().missing).toEqual(["fat"]);
    expect(store.list()).toHaveLength(0);
  });

  // cites: REQ-003/AC-011, R-003
  it("refuses a photo with the name and shop of a selectable product, whatever the brand", async () => {
    const { app, store } = setup({ ...FULL, brand: "Other Brand" });
    await seedProductA(store);
    const res = await upload(app);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.duplicate_name_shop");
    expect(store.list()).toHaveLength(1);
  });

  // cites: R-003
  it("compares name and shop ignoring letter case and extra spaces", async () => {
    const { app, store } = setup({ ...FULL, name: "  product   a ", shop: "SHOP A" });
    await seedProductA(store);
    expect((await upload(app)).statusCode).toBe(409);
  });

  // cites: REQ-003/AC-012, R-003
  it("refuses when the shop the Owner supplies makes a duplicate", async () => {
    const { app, store } = setup({ ...FULL, shop: null });
    await seedProductA(store);
    const asked = await upload(app);
    expect(asked.json().missing).toEqual(["shop"]);
    const res = await create(app, { ...asked.json().recognised, shop: "Shop A", source: "label" });
    expect(res.statusCode).toBe(409);
    expect(store.list()).toHaveLength(1);
  });

  // cites: REQ-003/AC-013, R-003
  it("refuses when the name the Owner supplies makes a duplicate", async () => {
    const { app, store } = setup({ ...FULL, name: null });
    await seedProductA(store);
    const asked = await upload(app);
    expect(asked.json().missing).toEqual(["name"]);
    const res = await create(app, { ...asked.json().recognised, name: "Product A", source: "label" });
    expect(res.statusCode).toBe(409);
    expect(store.list()).toHaveLength(1);
  });

  // cites: IF-001@1.0.0#addProductFromLabelPhoto
  it("returns 400 photo.unreadable when the photo part is missing", async () => {
    const { app } = setup(FULL);
    const form = multipart(PHOTO, "other");
    const res = await app.inject({
      method: "POST",
      url: "/products/label-photo",
      payload: form.payload,
      headers: form.headers,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("photo.unreadable");
  });

  // cites: IF-001@1.0.0#addProductFromLabelPhoto
  it("returns 502 recognition.unavailable when the provider fails", async () => {
    const { app, store } = setup(new Error("provider down"));
    const res = await upload(app);
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("recognition.unavailable");
    expect(store.list()).toHaveLength(0);
  });

  // cites: IF-001@1.0.0#addProductFromLabelPhoto
  it("echoes the X-Run-Id header as run_id in errors", async () => {
    const { app } = setup(new Error("provider down"));
    const res = await upload(app, { "x-run-id": "run-test-1" });
    expect(res.json().run_id).toBe("run-test-1");
  });

  // cites: IF-001@1.0.0#addProductFromLabelPhoto
  it("returns 401 auth.required without an owner check", async () => {
    const { app, provider } = setup(FULL, false);
    const res = await upload(app);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("auth.required");
    expect(provider.seen).toHaveLength(0);
  });
});

describe("createProduct", () => {
  const BODY = { name: "Product B", shop: "Shop B", calories: 120, protein: 3, fat: 2, source: "manual" };

  // cites: IF-001@1.0.0#createProduct, R-002
  it("saves a product with all required values", async () => {
    const { app, store } = setup(FULL);
    const res = await create(app, { ...BODY, brand: "Brand Y" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ...BODY, brand: "Brand Y" });
    expect(store.list()).toHaveLength(1);
  });

  // cites: R-002
  it("returns 422 listing every missing required value", async () => {
    const { app, store } = setup(FULL);
    const res = await create(app, { name: "Product B", source: "manual" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("product.values_missing");
    expect(res.json().missing).toEqual(["shop", "calories", "protein", "fat"]);
    expect(store.list()).toHaveLength(0);
  });

  // cites: R-002
  it("counts a negative nutrient value as missing", async () => {
    const { app } = setup(FULL);
    const res = await create(app, { ...BODY, protein: -1 });
    expect(res.statusCode).toBe(422);
    expect(res.json().missing).toEqual(["protein"]);
  });

  // cites: R-003
  it("returns 409 product.duplicate_name_shop for a duplicate name and shop", async () => {
    const { app, store } = setup(FULL);
    await seedProductA(store);
    const res = await create(app, { ...BODY, name: "product a", shop: "SHOP A" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("product.duplicate_name_shop");
  });

  // cites: IF-001@1.0.0#createProduct
  it("returns 401 auth.required without an owner check", async () => {
    const { app, store } = setup(FULL, false);
    const res = await create(app, BODY);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("auth.required");
    expect(store.list()).toHaveLength(0);
  });
});
