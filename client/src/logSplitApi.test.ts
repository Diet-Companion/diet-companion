import { describe, expect, it } from "vitest";
import type { FetchLike } from "./api";
import { createLogApi } from "./logApi";

function fake(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(body === null ? null : JSON.stringify(body), { status });
  };
  return { api: createLogApi(fn, () => "run-1"), calls };
}

const WHITE = { id: "p-white", name: "egg white", calories: 50, deleted: false, replaced_by: null };
const EGG = { id: "p-egg", name: "egg", calories: 140, deleted: false, replaced_by: null };
const E1 = { id: "e1", meal: "lunch", position: 0, product: WHITE, dish: null, grams: 150, pieces: null, weight_grams: 150 };
const E2 = { id: "e2", meal: "lunch", position: 1, product: EGG, dish: null, grams: null, pieces: 2, weight_grams: 100 };

describe("log api: addLogDishProducts", () => {
  // cites: REQ-014/AC-005, REQ-014/AC-010, IF-001@1.5.0#addLogDishProducts
  it("posts the dish with only the changed lines and reads the entries in the order of the dish lines", async () => {
    const { api, calls } = fake(201, { entries: [E1, E2] });
    const result = await api.addLogDishProducts("2026-01-05", {
      meal: "lunch",
      dish_id: "d-omelette",
      lines: [{ position: 0, grams: 150 }],
    });
    expect(calls[0]?.url).toBe("/days/2026-01-05/log/dish-products");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({ "X-Run-Id": "run-1", "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      meal: "lunch",
      dish_id: "d-omelette",
      lines: [{ position: 0, grams: 150 }],
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.entries.map((e) => [e.product?.name, e.grams, e.pieces])).toEqual([
      ["egg white", 150, null],
      ["egg", null, 2],
    ]);
  });

  // cites: REQ-014/AC-005, IF-001@1.5.0#addLogDishProducts
  it("reads the code, reasons and refused lines of an entry.invalid refusal", async () => {
    const { api } = fake(400, {
      code: "entry.invalid",
      message: "No.",
      reasons: ["amount_invalid"],
      lines: [{ index: 0, reason: "amount_invalid" }, { index: "x" }],
    });
    const r = await api.addLogDishProducts("2026-01-05", { meal: "lunch", dish_id: "d", lines: [{ position: 1, grams: 0 }] });
    if (r.kind !== "refused") throw new Error("expected refused");
    expect(r.error.code).toBe("entry.invalid");
    expect(r.error.reasons).toEqual(["amount_invalid"]);
    expect(r.lines).toEqual([{ index: 0, reason: "amount_invalid" }]);
  });

  // cites: REQ-014/AC-005, IF-001@1.5.0#addLogDishProducts
  it("reads a closed day, an out-of-range day, 401 and a broken reply", async () => {
    const input = { meal: "lunch" as const, dish_id: "d" };
    const closed = await fake(409, { code: "day.closed", message: "Closed." }).api.addLogDishProducts("2026-01-05", input);
    expect(closed.kind === "refused" && closed.error.code).toBe("day.closed");
    expect(closed.kind === "refused" && closed.lines).toEqual([]);
    const range = await fake(422, { code: "log.day_out_of_range" }).api.addLogDishProducts("2026-01-06", input);
    expect(range.kind === "refused" && range.error.code).toBe("log.day_out_of_range");
    const denied = await fake(401, { code: "auth.required" }).api.addLogDishProducts("2026-01-05", input);
    expect(denied.kind).toBe("unauthorized");
    const broken = await fake(201, { nope: true }).api.addLogDishProducts("2026-01-05", input);
    expect(broken.kind).toBe("failed");
  });
});
