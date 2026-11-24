import { describe, expect, it } from "vitest";
import type { FetchLike } from "./api";
import { createDishApi } from "./dishApi";

const OMELETTE = {
  id: "d-1",
  name: "omelette",
  lines: [
    { position: 0, product: { id: "p-1", name: "egg white" }, grams: 100, pieces: null, weight_grams: 100 },
    {
      position: 1,
      product: { id: "p-2", name: "egg", selectable: false, deleted: true },
      grams: null,
      pieces: 2,
      weight_grams: 100,
    },
  ],
  total_weight_grams: 200,
  replaced_by: null,
  deleted: false,
  selectable: true,
  has_unselectable_product: true,
};

function fake(status: number, body: unknown) {
  const calls: { url: string; method: string | undefined }[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    calls.push({ url: input, method: init?.method });
    return new Response(JSON.stringify(body), { status });
  };
  return { api: createDishApi(fetchFn, () => "run-1"), calls };
}

describe("dish api", () => {
  // cites: REQ-006/AC-002, IF-001@1.3.0#listDishes
  it("lists selectable dishes and keeps the line weight the server computed", async () => {
    const { api, calls } = fake(200, [OMELETTE]);
    const r = await api.listDishes("selectable");
    expect(calls[0]).toEqual({ url: "/dishes", method: "GET" });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.dishes[0]?.lines[1]?.pieces).toBe(2);
      expect(r.dishes[0]?.lines[1]?.weight_grams).toBe(100);
    }
  });

  // cites: REQ-006/AC-016, IF-001@1.3.0#listDishes
  it("asks for the deleted dishes with state=deleted", async () => {
    const { api, calls } = fake(200, []);
    await api.listDishes("deleted");
    expect(calls[0]?.url).toBe("/dishes?state=deleted");
  });

  // cites: REQ-006/AC-011, IF-001@1.3.0#deleteDish
  it("deletes a dish with DELETE and returns the dish", async () => {
    const { api, calls } = fake(200, { ...OMELETTE, deleted: true, selectable: false });
    const r = await api.deleteDish("d-1");
    expect(calls[0]).toEqual({ url: "/dishes/d-1", method: "DELETE" });
    expect(r.kind === "ok" && r.dish.deleted).toBe(true);
  });

  // cites: REQ-006/AC-011, IF-001@1.3.0#deleteDish
  it("maps 409 dish.not_selectable, 404 and 401", async () => {
    const conflict = fake(409, { code: "dish.not_selectable", message: "x" });
    expect((await conflict.api.deleteDish("d-1")).kind).toBe("not_selectable");
    const missing = fake(404, { code: "dish.not_found", message: "x" });
    expect((await missing.api.deleteDish("d-1")).kind).toBe("not_found");
    const denied = fake(401, { code: "auth.required", message: "x" });
    expect((await denied.api.deleteDish("d-1")).kind).toBe("unauthorized");
    expect((await fake(401, {}).api.listDishes("selectable")).kind).toBe("unauthorized");
  });

  // cites: REQ-006/AC-016, IF-001@1.3.0#restoreDish
  it("restores a dish with POST /dishes/{id}/restore", async () => {
    const { api, calls } = fake(200, OMELETTE);
    const r = await api.restoreDish("d-1");
    expect(calls[0]).toEqual({ url: "/dishes/d-1/restore", method: "POST" });
    expect(r.kind).toBe("ok");
  });
});
