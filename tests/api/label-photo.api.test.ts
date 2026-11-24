// API tests for REQ-003: add a product from a label photo (S-QA-004). The label provider is faked at its seam.
// AC-005 (the photo is deleted) cannot be observed through IF-001, so it is not tested here.
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { LabelValues } from "@diet-companion/label-reader";
import { newProduct, PNG_BYTES, startApi, type Api } from "./support/api.js";

const unique = (prefix: string): string => `${prefix} ${randomUUID().slice(0, 8)}`;

function label(overrides: Partial<LabelValues> = {}): LabelValues {
  return { name: unique("Label Product"), shop: "Shop A", calories: 120, protein: 8, fat: 4, brand: null, ...overrides };
}

/** Starts an API with its own fake label result, logs in, and always closes it. */
async function withApi(labelResult: LabelValues | Error, run: (api: Api) => Promise<void>): Promise<void> {
  const api = await startApi({ label: labelResult });
  try {
    await api.login();
    await run(api);
  } finally {
    await api.close();
  }
}

async function countByName(api: Api, name: string): Promise<number> {
  const res = await api.request("GET", "/products");
  return (res.json() as Array<{ name: string }>).filter((p) => p.name === name).length;
}

describe("add a product from a label photo", () => {
  // cites: REQ-003/AC-010, R-003, IF-001@1.3.0#addProductFromLabelPhoto
  it("saves a label with name, shop, calories, protein and fat straight away with source label", async () => {
    const values = label();
    await withApi(values, async (api) => {
      const res = await api.labelPhoto(PNG_BYTES);
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        name: values.name,
        shop: "Shop A",
        calories: 120,
        protein: 8,
        fat: 4,
        source: "label",
      });
      expect(await countByName(api, values.name as string)).toBe(1);
    });
  });

  // cites: REQ-003/AC-002, R-002, IF-001@1.3.0#addProductFromLabelPhoto, IF-001@1.3.0#createProduct
  it("asks for a missing shop, saves nothing, and saves once the shop is supplied", async () => {
    const values = label({ shop: null });
    await withApi(values, async (api) => {
      const res = await api.labelPhoto(PNG_BYTES);
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("product.values_missing");
      expect(res.json().missing).toEqual(["shop"]);
      expect(res.json().recognised).toMatchObject({ name: values.name, calories: 120, protein: 8, fat: 4 });
      expect(await countByName(api, values.name as string)).toBe(0);

      const created = await api.request(
        "POST",
        "/products",
        newProduct({ name: values.name, shop: "Shop B", calories: 120, protein: 8, fat: 4, source: "label" }),
      );
      expect(created.statusCode).toBe(201);
      expect(await countByName(api, values.name as string)).toBe(1);
    });
  });

  // cites: REQ-003/AC-003, R-002, IF-001@1.3.0#addProductFromLabelPhoto, IF-001@1.3.0#createProduct
  it("asks for protein when it is not recognised, and saves nothing until it is supplied", async () => {
    const values = label({ protein: null });
    await withApi(values, async (api) => {
      const res = await api.labelPhoto(PNG_BYTES);
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("product.values_missing");
      expect(res.json().missing).toEqual(["protein"]);
      expect(res.json().recognised).toMatchObject({ name: values.name, shop: "Shop A", calories: 120, fat: 4 });
      expect(await countByName(api, values.name as string)).toBe(0);

      const created = await api.request(
        "POST",
        "/products",
        newProduct({ name: values.name, shop: "Shop A", calories: 120, protein: 9, fat: 4, source: "label" }),
      );
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ protein: 9 });
    });
  });

  // cites: REQ-003/AC-004, R-002, IF-001@1.3.0#addProductFromLabelPhoto
  it("asks for the name when the label gives none", async () => {
    await withApi(label({ name: null }), async (api) => {
      const res = await api.labelPhoto(PNG_BYTES);
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("product.values_missing");
      expect(res.json().missing).toEqual(["name"]);
      expect(res.json().recognised).toMatchObject({ shop: "Shop A", calories: 120, protein: 8, fat: 4 });
      const list = await api.request("GET", "/products");
      expect(list.json()).toHaveLength(0);
    });
  });

  // cites: REQ-003/AC-007, R-002, IF-001@1.3.0#addProductFromLabelPhoto
  it("asks for calories when they are not recognised, and saves nothing", async () => {
    const values = label({ calories: null });
    await withApi(values, async (api) => {
      const res = await api.labelPhoto(PNG_BYTES);
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("product.values_missing");
      expect(res.json().missing).toEqual(["calories"]);
      expect(res.json().recognised).toMatchObject({ name: values.name, shop: "Shop A", protein: 8, fat: 4 });
      expect(await countByName(api, values.name as string)).toBe(0);
    });
  });

  // cites: REQ-003/AC-008, R-002, IF-001@1.3.0#addProductFromLabelPhoto
  it("asks for fat when it is not recognised, and saves nothing", async () => {
    const values = label({ fat: null });
    await withApi(values, async (api) => {
      const res = await api.labelPhoto(PNG_BYTES);
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("product.values_missing");
      expect(res.json().missing).toEqual(["fat"]);
      expect(res.json().recognised).toMatchObject({ name: values.name, shop: "Shop A", calories: 120, protein: 8 });
      expect(await countByName(api, values.name as string)).toBe(0);
    });
  });

  // cites: REQ-003/AC-011, R-003, IF-001@1.3.0#addProductFromLabelPhoto
  it("refuses a photo with the same name and shop as a selectable product, whatever the brand", async () => {
    const name = unique("Product A");
    await withApi(label({ name, shop: "Shop A", brand: "Other Brand" }), async (api) => {
      const seeded = await api.request("POST", "/products", newProduct({ name, shop: "Shop A", brand: "First Brand" }));
      expect(seeded.statusCode).toBe(201);

      const res = await api.labelPhoto(PNG_BYTES);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("product.duplicate_name_shop");
      expect(await countByName(api, name)).toBe(1);
    });
  });

  // cites: REQ-003/AC-012, R-003, IF-001@1.3.0#addProductFromLabelPhoto, IF-001@1.3.0#createProduct
  it("refuses a createProduct whose supplied shop makes a duplicate of a selectable product", async () => {
    const name = unique("Product A");
    await withApi(label({ name, shop: null }), async (api) => {
      const seeded = await api.request("POST", "/products", newProduct({ name, shop: "Shop A" }));
      expect(seeded.statusCode).toBe(201);

      const photo = await api.labelPhoto(PNG_BYTES);
      expect(photo.statusCode).toBe(422);
      expect(photo.json().missing).toEqual(["shop"]);

      const res = await api.request(
        "POST",
        "/products",
        newProduct({ name, shop: "Shop A", calories: 120, protein: 8, fat: 4, source: "label" }),
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("product.duplicate_name_shop");
      expect(await countByName(api, name)).toBe(1);
    });
  });

  // cites: REQ-003/AC-013, R-003, IF-001@1.3.0#addProductFromLabelPhoto, IF-001@1.3.0#createProduct
  it("refuses a createProduct whose supplied name makes a duplicate of a selectable product", async () => {
    const name = unique("Product A");
    await withApi(label({ name: null, shop: "Shop A" }), async (api) => {
      const seeded = await api.request("POST", "/products", newProduct({ name, shop: "Shop A" }));
      expect(seeded.statusCode).toBe(201);

      const photo = await api.labelPhoto(PNG_BYTES);
      expect(photo.statusCode).toBe(422);
      expect(photo.json().missing).toEqual(["name"]);

      const res = await api.request(
        "POST",
        "/products",
        newProduct({ name, shop: "Shop A", calories: 120, protein: 8, fat: 4, source: "label" }),
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("product.duplicate_name_shop");
      expect(await countByName(api, name)).toBe(1);
    });
  });

  // cites: IF-001@1.3.0#addProductFromLabelPhoto
  it("answers 502 recognition.unavailable when the provider fails, and saves nothing", async () => {
    await withApi(new Error("provider down"), async (api) => {
      const res = await api.labelPhoto(PNG_BYTES);
      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe("recognition.unavailable");
      const list = await api.request("GET", "/products");
      expect(list.json()).toHaveLength(0);
    });
  });

  // cites: IF-001@1.3.0#addProductFromLabelPhoto
  it("answers 400 photo.unreadable for an empty photo, and saves nothing", async () => {
    await withApi(label(), async (api) => {
      const res = await api.labelPhoto(new Uint8Array());
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("photo.unreadable");
      const list = await api.request("GET", "/products");
      expect(list.json()).toHaveLength(0);
    });
  });
});
