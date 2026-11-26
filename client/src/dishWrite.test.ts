import { describe, expect, it } from "vitest";
import type { FetchLike } from "./api";
import { createDishApi } from "./dishApi";

const DISH = {
  id: "d-2",
  name: "omelette",
  lines: [{ position: 0, product: { id: "p-1", name: "egg white" }, grams: 100, pieces: null, weight_grams: 100 }],
  total_weight_grams: 100,
  replaced_by: null,
  deleted: false,
  selectable: true,
  has_unselectable_product: false,
};

function fake(status: number, body: unknown) {
  const calls: { url: string; method: string | undefined; body: unknown }[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    const sent = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ url: input, method: init?.method, body: sent });
    return new Response(JSON.stringify(body), { status });
  };
  return { api: createDishApi(fetchFn, () => "run-1"), calls };
}

const NEW_DISH = { name: "omelette", lines: [{ product_id: "p-1", grams: 100 }] };

describe("dish api: create and edit", () => {
  // cites: REQ-006/AC-001, IF-001@1.3.0#createDish
  it("creates a dish with POST /dishes and the body", async () => {
    const { api, calls } = fake(201, DISH);
    const r = await api.createDish(NEW_DISH);
    expect(calls[0]).toEqual({ url: "/dishes", method: "POST", body: NEW_DISH });
    expect(r.kind === "ok" && r.dish.id).toBe("d-2");
  });

  // cites: REQ-006/AC-003, IF-001@1.3.0#createDish
  it("returns each refused line with its reason on 400 dish.line_invalid", async () => {
    const { api } = fake(400, {
      code: "dish.line_invalid",
      message: "refused",
      lines: [{ index: 0, reason: "piece_without_weight" }],
    });
    const r = await api.createDish(NEW_DISH);
    expect(r).toEqual({
      kind: "line_invalid",
      lines: [{ index: 0, reason: "piece_without_weight" }],
      message: "refused",
    });
  });

  // cites: REQ-006/AC-013, REQ-006/AC-014, IF-001@1.3.0#createDish
  it("returns what is missing on 422 dish.values_missing", async () => {
    const { api } = fake(422, { code: "dish.values_missing", message: "missing", missing: ["name"] });
    const r = await api.createDish({ name: "", lines: [] });
    expect(r.kind === "values_missing" && r.missing).toEqual(["name"]);
  });

  // cites: REQ-006/AC-009, IF-001@1.3.0#editDish
  it("edits with PATCH and marks a 201 as a new dish", async () => {
    const { api, calls } = fake(201, { dish: DISH, versioned: true, replaced_id: "d-1" });
    const r = await api.editDish("d-1", { lines: NEW_DISH.lines });
    expect(calls[0]).toEqual({ url: "/dishes/d-1", method: "PATCH", body: { lines: NEW_DISH.lines } });
    expect(r.kind === "ok" && r.versioned).toBe(true);
  });

  // cites: REQ-006/AC-009, IF-001@1.3.0#editDish
  it("marks a 200 name-only edit as not versioned", async () => {
    const { api } = fake(200, { dish: DISH, versioned: false, replaced_id: null });
    const r = await api.editDish("d-2", { name: "big omelette" });
    expect(r.kind === "ok" && r.versioned).toBe(false);
  });

  // cites: REQ-006/AC-009, IF-001@1.3.0#editDish
  it("maps 409 dish.not_selectable, 404 and 401", async () => {
    const a = fake(409, { code: "dish.not_selectable", message: "gone" });
    expect(await a.api.editDish("d-1", { name: "x" })).toEqual({ kind: "not_selectable", message: "gone" });
    const b = fake(404, { code: "dish.not_found", message: "none" });
    expect(await b.api.editDish("d-1", { name: "x" })).toEqual({ kind: "not_found" });
    const c = fake(401, { code: "auth.required", message: "login" });
    expect(await c.api.editDish("d-1", { name: "x" })).toEqual({ kind: "unauthorized" });
  });

  // cites: REQ-006/AC-017, IF-001@1.3.0#createDish
  it("sends a name that another dish already has without any check", async () => {
    const { api, calls } = fake(201, DISH);
    await api.createDish(NEW_DISH);
    await api.createDish(NEW_DISH);
    expect(calls.map((c) => c.method)).toEqual(["POST", "POST"]);
  });
});
