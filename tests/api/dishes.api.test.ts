// API tests for REQ-006: save, use, edit and soft-delete dishes (S-QA-004). Each test creates its own data.
// Parts of REQ-006 that need day plans or the journal (AC-004 to AC-008) are not covered here.
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

function unique(label: string): string {
  return `${label} ${randomUUID().slice(0, 8)}`;
}

async function createProduct(overrides: Record<string, unknown> = {}): Promise<any> {
  const res = await api.request("POST", "/products", newProduct({ name: unique("Prod"), ...overrides }));
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function createDish(name: string, lines: unknown[]): Promise<any> {
  const res = await api.request("POST", "/dishes", { name, lines });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function listIds(state?: string): Promise<string[]> {
  const res = await api.request("GET", state ? `/dishes?state=${state}` : "/dishes");
  expect(res.statusCode).toBe(200);
  return (res.json() as Array<{ id: string }>).map((d) => d.id);
}

describe("dish API", () => {
  // cites: REQ-006/AC-001, REQ-006/AC-002, R-007, IF-001@1.3.0#createDish
  it("saves a dish with a gram line and a piece line, with the line weight pieces times piece weight", async () => {
    const eggWhite = await createProduct();
    const egg = await createProduct({ piece_weight: 50 });
    const res = await api.request("POST", "/dishes", {
      name: unique("omelette"),
      lines: [
        { product_id: eggWhite.id, grams: 100 },
        { product_id: egg.id, pieces: 2 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const dish = res.json();
    expect(dish.lines).toHaveLength(2);
    expect(dish.lines[0]).toMatchObject({ position: 0, grams: 100, pieces: null, weight_grams: 100 });
    expect(dish.lines[0].product.id).toBe(eggWhite.id);
    expect(dish.lines[1]).toMatchObject({ position: 1, grams: null, pieces: 2, weight_grams: 100 });
    expect(dish.lines[1].product.id).toBe(egg.id);
    expect(dish.total_weight_grams).toBe(200);
    expect(dish).toMatchObject({ replaced_by: null, deleted: false, selectable: true });
    const read = await api.request("GET", `/dishes/${dish.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json().id).toBe(dish.id);
    expect(await listIds()).toContain(dish.id);
  });

  // cites: REQ-006/AC-003, R-007, IF-001@1.3.0#createDish
  it("refuses pieces for a product without a piece weight with dish.line_invalid and saves nothing", async () => {
    const ok = await createProduct();
    const noWeight = await createProduct();
    const name = unique("refused");
    const res = await api.request("POST", "/dishes", {
      name,
      lines: [
        { product_id: ok.id, grams: 50 },
        { product_id: noWeight.id, pieces: 2 },
      ],
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("dish.line_invalid");
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({ index: 1, reason: "piece_without_weight" });
    const all = (await api.request("GET", "/dishes")).json() as Array<{ name: string }>;
    expect(all.filter((d) => d.name === name)).toHaveLength(0);
  });

  // cites: REQ-006/AC-003, R-007, IF-001@1.3.0#createDish
  it("accepts grams for a product without a piece weight", async () => {
    const p = await createProduct();
    const dish = await createDish(unique("grams only"), [{ product_id: p.id, grams: 75 }]);
    expect(dish.lines[0]).toMatchObject({ grams: 75, weight_grams: 75 });
  });

  // cites: R-007, ADR-014/C-001, IF-001@1.3.0#createDish
  it("refuses a line with an unknown product with dish.line_invalid and reason product_not_found", async () => {
    const res = await api.request("POST", "/dishes", {
      name: unique("ghost"),
      lines: [{ product_id: randomUUID(), grams: 10 }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("dish.line_invalid");
    expect(res.json().lines[0]).toMatchObject({ index: 0, reason: "product_not_found" });
  });

  // cites: R-007, ADR-014/C-001, IF-001@1.3.0#createDish
  it("refuses a new line with a replaced product with reason product_not_selectable", async () => {
    const p = await createProduct({ calories: 100 });
    await api.request("PATCH", `/products/${p.id}`, { calories: 120 });
    const res = await api.request("POST", "/dishes", {
      name: unique("stale"),
      lines: [{ product_id: p.id, grams: 10 }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("dish.line_invalid");
    expect(res.json().lines[0]).toMatchObject({ index: 0, reason: "product_not_selectable" });
  });

  // cites: REQ-006/AC-013, R-007, IF-001@1.3.0#createDish
  it("does not save a dish with a name and no lines, and reports the missing lines", async () => {
    const name = unique("empty");
    const res = await api.request("POST", "/dishes", { name, lines: [] });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("dish.values_missing");
    expect(res.json().missing).toContain("lines");
    const all = (await api.request("GET", "/dishes")).json() as Array<{ name: string }>;
    expect(all.filter((d) => d.name === name)).toHaveLength(0);
  });

  // cites: REQ-006/AC-014, R-007, IF-001@1.3.0#createDish
  it("does not save a dish with one line and no name, and reports the missing name", async () => {
    const p = await createProduct();
    const res = await api.request("POST", "/dishes", { lines: [{ product_id: p.id, grams: 10 }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("dish.values_missing");
    expect(res.json().missing).toContain("name");
  });

  // cites: REQ-006/AC-014, R-007, IF-001@1.3.0#createDish
  it("treats a blank name as missing", async () => {
    const p = await createProduct();
    const res = await api.request("POST", "/dishes", { name: "   ", lines: [{ product_id: p.id, grams: 10 }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("dish.values_missing");
    expect(res.json().missing).toContain("name");
  });

  // cites: REQ-006/AC-009, R-008, IF-001@1.3.0#editDish
  it("records a new dish when an amount changes, with versioned true and replaced_id", async () => {
    const p = await createProduct();
    const d = await createDish(unique("amount"), [{ product_id: p.id, grams: 100 }]);
    const res = await api.request("PATCH", `/dishes/${d.id}`, { lines: [{ product_id: p.id, grams: 150 }] });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.versioned).toBe(true);
    expect(body.replaced_id).toBe(d.id);
    expect(body.dish.id === d.id).toBe(false);
    expect(body.dish.lines[0]).toMatchObject({ grams: 150, weight_grams: 150 });
    expect(body.dish).toMatchObject({ selectable: true, replaced_by: null });
  });

  // cites: REQ-006/AC-009, REQ-006/AC-010, R-008, IF-001@1.3.0#getDish
  it("keeps the old dish readable, unchanged, unselectable and pointing to the new one", async () => {
    const p = await createProduct();
    const d = await createDish(unique("old"), [{ product_id: p.id, grams: 100 }]);
    const edited = (await api.request("PATCH", `/dishes/${d.id}`, { lines: [{ product_id: p.id, grams: 150 }] })).json();
    const res = await api.request("GET", `/dishes/${d.id}`);
    expect(res.statusCode).toBe(200);
    const old = res.json();
    expect(old).toMatchObject({ id: d.id, name: d.name, selectable: false, replaced_by: edited.dish.id });
    expect(old.lines).toHaveLength(1);
    expect(old.lines[0]).toMatchObject({ grams: 100, weight_grams: 100 });
    expect(old.lines[0].product.id).toBe(p.id);
  });

  // cites: REQ-006/AC-010, R-008, IF-001@1.3.0#listDishes
  it("lists the new dish and not the replaced one", async () => {
    const p = await createProduct();
    const d = await createDish(unique("listed"), [{ product_id: p.id, grams: 100 }]);
    const edited = (await api.request("PATCH", `/dishes/${d.id}`, { lines: [{ product_id: p.id, grams: 120 }] })).json();
    const ids = await listIds();
    expect(ids).toContain(edited.dish.id);
    expect(ids.includes(d.id)).toBe(false);
    expect((await listIds("deleted")).includes(d.id)).toBe(false);
  });

  // cites: REQ-006/AC-009, R-008, IF-001@1.3.0#editDish
  it("records a new dish when only the order of the lines changes", async () => {
    const a = await createProduct();
    const b = await createProduct();
    const d = await createDish(unique("order"), [
      { product_id: a.id, grams: 10 },
      { product_id: b.id, grams: 20 },
    ]);
    const res = await api.request("PATCH", `/dishes/${d.id}`, {
      lines: [
        { product_id: b.id, grams: 20 },
        { product_id: a.id, grams: 10 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ versioned: true, replaced_id: d.id });
    expect(body.dish.lines[0].product.id).toBe(b.id);
    expect(body.dish.lines[1].product.id).toBe(a.id);
  });

  // cites: REQ-006/AC-009, R-008, ADR-013/C-001, IF-001@1.3.0#editDish
  it("changes a name in place with no new dish", async () => {
    const p = await createProduct();
    const d = await createDish(unique("name"), [{ product_id: p.id, grams: 100 }]);
    const newName = unique("Renamed dish");
    const res = await api.request("PATCH", `/dishes/${d.id}`, { name: newName });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.versioned).toBe(false);
    expect(body.replaced_id).toBe(null);
    expect(body.dish.id).toBe(d.id);
    expect(body.dish.name).toBe(newName);
    const read = (await api.request("GET", `/dishes/${d.id}`)).json();
    expect(read).toMatchObject({ name: newName, selectable: true, replaced_by: null });
  });

  // cites: R-008, ADR-013/C-001, IF-001@1.3.0#editDish
  it("records nothing for a request that changes nothing", async () => {
    const p = await createProduct();
    const d = await createDish(unique("same"), [{ product_id: p.id, grams: 100 }]);
    const res = await api.request("PATCH", `/dishes/${d.id}`, { name: d.name });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ versioned: false, replaced_id: null });
    expect(res.json().dish.id).toBe(d.id);
  });

  // cites: R-008, IF-001@1.3.0#editDish
  it("refuses to edit a replaced dish with dish.not_selectable", async () => {
    const p = await createProduct();
    const d = await createDish(unique("replaced"), [{ product_id: p.id, grams: 100 }]);
    await api.request("PATCH", `/dishes/${d.id}`, { lines: [{ product_id: p.id, grams: 110 }] });
    const res = await api.request("PATCH", `/dishes/${d.id}`, { name: unique("x") });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("dish.not_selectable");
  });

  // cites: R-008, IF-001@1.3.0#deleteDish
  it("refuses to delete a replaced dish with dish.not_selectable", async () => {
    const p = await createProduct();
    const d = await createDish(unique("replaced del"), [{ product_id: p.id, grams: 100 }]);
    await api.request("PATCH", `/dishes/${d.id}`, { lines: [{ product_id: p.id, grams: 110 }] });
    const res = await api.request("DELETE", `/dishes/${d.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("dish.not_selectable");
  });

  // cites: R-008, IF-001@1.3.0#restoreDish
  it("refuses to restore a replaced dish with dish.not_selectable", async () => {
    const p = await createProduct();
    const d = await createDish(unique("replaced res"), [{ product_id: p.id, grams: 100 }]);
    await api.request("PATCH", `/dishes/${d.id}`, { lines: [{ product_id: p.id, grams: 110 }] });
    const res = await api.request("POST", `/dishes/${d.id}/restore`);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("dish.not_selectable");
  });

  // cites: REQ-006/AC-015, R-009, ADR-014/C-002, IF-001@1.3.0#getDish
  it("keeps the exact product on a line after a nutrient edit and flags the dish", async () => {
    const p = await createProduct({ calories: 100 });
    const d = await createDish(unique("keeps"), [{ product_id: p.id, grams: 100 }]);
    const edited = (await api.request("PATCH", `/products/${p.id}`, { calories: 120 })).json();
    const res = await api.request("GET", `/dishes/${d.id}`);
    expect(res.statusCode).toBe(200);
    const dish = res.json();
    expect(dish.id).toBe(d.id);
    expect(dish.lines[0].product.id).toBe(p.id);
    expect(dish.lines[0].product.id === edited.product.id).toBe(false);
    expect(dish.lines[0].product).toMatchObject({ calories: 100, selectable: false, replaced_by: edited.product.id });
    expect(dish.lines[0]).toMatchObject({ grams: 100, weight_grams: 100 });
    expect(dish.has_unselectable_product).toBe(true);
    expect(dish).toMatchObject({ selectable: true, replaced_by: null, deleted: false });
    expect(await listIds()).toContain(d.id);
  });

  // cites: REQ-006/AC-018, R-009, ADR-014/C-002, IF-001@1.3.0#getDish
  it("shows a product renamed in place by its new name, with no new dish", async () => {
    const p = await createProduct();
    const d = await createDish(unique("rename"), [{ product_id: p.id, grams: 80 }]);
    const newName = unique("Product B");
    const renamed = await api.request("PATCH", `/products/${p.id}`, { name: newName });
    expect(renamed.statusCode).toBe(200);
    const res = await api.request("GET", `/dishes/${d.id}`);
    expect(res.statusCode).toBe(200);
    const dish = res.json();
    expect(dish.id).toBe(d.id);
    expect(dish.replaced_by).toBe(null);
    expect(dish.lines[0].product).toMatchObject({ id: p.id, name: newName, calories: 100 });
    expect(dish.lines[0]).toMatchObject({ grams: 80, weight_grams: 80 });
    expect(dish.has_unselectable_product).toBe(false);
  });

  // cites: REQ-006/AC-015, R-009, ADR-014/C-001, IF-001@1.3.0#editDish
  it("carries over a line whose product was replaced when the dish is edited", async () => {
    const p = await createProduct({ calories: 100 });
    const q = await createProduct();
    const d = await createDish(unique("carry"), [{ product_id: p.id, grams: 100 }]);
    await api.request("PATCH", `/products/${p.id}`, { calories: 120 });
    const res = await api.request("PATCH", `/dishes/${d.id}`, {
      lines: [
        { product_id: p.id, grams: 100 },
        { product_id: q.id, grams: 30 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.versioned).toBe(true);
    expect(body.dish.lines[0].product.id).toBe(p.id);
    expect(body.dish.lines[1].product.id).toBe(q.id);
    expect(body.dish.has_unselectable_product).toBe(true);
  });

  // cites: R-009, ADR-014/C-001, IF-001@1.3.0#editDish
  it("refuses a new line with a replaced product on edit with reason product_not_selectable", async () => {
    const p = await createProduct({ calories: 100 });
    const q = await createProduct();
    await api.request("PATCH", `/products/${p.id}`, { calories: 120 });
    const d = await createDish(unique("newline"), [{ product_id: q.id, grams: 10 }]);
    const res = await api.request("PATCH", `/dishes/${d.id}`, {
      lines: [
        { product_id: q.id, grams: 10 },
        { product_id: p.id, grams: 10 },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("dish.line_invalid");
    expect(res.json().lines[0]).toMatchObject({ index: 1, reason: "product_not_selectable" });
    const read = (await api.request("GET", `/dishes/${d.id}`)).json();
    expect(read).toMatchObject({ selectable: true, replaced_by: null });
  });

  // cites: REQ-006/AC-011, REQ-006/AC-012, R-010, IF-001@1.3.0#deleteDish
  it("soft-deletes a dish: it leaves the list, shows under state deleted and stays readable by id", async () => {
    const p = await createProduct();
    const d = await createDish(unique("gone"), [{ product_id: p.id, grams: 100 }]);
    const res = await api.request("DELETE", `/dishes/${d.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: d.id, deleted: true, selectable: false });
    expect((await listIds()).includes(d.id)).toBe(false);
    expect(await listIds("deleted")).toContain(d.id);
    const read = await api.request("GET", `/dishes/${d.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ id: d.id, deleted: true, selectable: false });
  });

  // cites: REQ-006/AC-012, R-010, IF-001@1.3.0#editDish
  it("refuses to edit a soft-deleted dish with dish.not_selectable", async () => {
    const p = await createProduct();
    const d = await createDish(unique("deleted edit"), [{ product_id: p.id, grams: 100 }]);
    await api.request("DELETE", `/dishes/${d.id}`);
    const res = await api.request("PATCH", `/dishes/${d.id}`, { name: unique("x") });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("dish.not_selectable");
  });

  // cites: REQ-006/AC-016, R-010, IF-001@1.3.0#restoreDish
  it("restores a soft-deleted dish, selectable again with the same lines", async () => {
    const p = await createProduct();
    const d = await createDish(unique("back"), [{ product_id: p.id, grams: 100 }]);
    await api.request("DELETE", `/dishes/${d.id}`);
    const res = await api.request("POST", `/dishes/${d.id}/restore`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ id: d.id, name: d.name, deleted: false, selectable: true });
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({ grams: 100, weight_grams: 100 });
    expect(body.lines[0].product.id).toBe(p.id);
    expect(await listIds()).toContain(d.id);
    expect((await listIds("deleted")).includes(d.id)).toBe(false);
  });

  // cites: R-010, IF-001@1.3.0#deleteDish, IF-001@1.3.0#restoreDish
  it("returns an already soft-deleted dish unchanged on delete, and a selectable one unchanged on restore", async () => {
    const p = await createProduct();
    const d = await createDish(unique("twice"), [{ product_id: p.id, grams: 100 }]);
    const same = await api.request("POST", `/dishes/${d.id}/restore`);
    expect(same.statusCode).toBe(200);
    expect(same.json()).toMatchObject({ id: d.id, deleted: false, selectable: true });
    await api.request("DELETE", `/dishes/${d.id}`);
    const again = await api.request("DELETE", `/dishes/${d.id}`);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id: d.id, deleted: true });
  });

  // cites: REQ-006/AC-017, R-010, IF-001@1.3.0#createDish
  it("saves a second dish with the same name and lists both", async () => {
    const p = await createProduct();
    const name = unique("omelette");
    const first = await createDish(name, [{ product_id: p.id, grams: 100 }]);
    const res = await api.request("POST", "/dishes", { name, lines: [{ product_id: p.id, grams: 100 }] });
    expect(res.statusCode).toBe(201);
    const second = res.json();
    expect(second.id === first.id).toBe(false);
    expect(second.name).toBe(name);
    const ids = await listIds();
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
  });

  // cites: IF-001@1.3.0#getDish, IF-001@1.3.0#editDish, IF-001@1.3.0#deleteDish, IF-001@1.3.0#restoreDish
  it("answers dish.not_found for an unknown dish id on get, edit, delete and restore", async () => {
    const id = randomUUID();
    const get = await api.request("GET", `/dishes/${id}`);
    expect(get.statusCode).toBe(404);
    expect(get.json().code).toBe("dish.not_found");
    const edit = await api.request("PATCH", `/dishes/${id}`, { name: unique("x") });
    expect(edit.statusCode).toBe(404);
    expect(edit.json().code).toBe("dish.not_found");
    const del = await api.request("DELETE", `/dishes/${id}`);
    expect(del.statusCode).toBe(404);
    expect(del.json().code).toBe("dish.not_found");
    const res = await api.request("POST", `/dishes/${id}/restore`);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("dish.not_found");
  });
});
