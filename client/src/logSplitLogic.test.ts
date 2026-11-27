import { describe, expect, it, vi } from "vitest";
import type { ListResult } from "./api";
import type { Dish, DishListResult } from "./dishApi";
import type { DishProductsInput, LogApi, LogDay, LogEntry, LogSplitApi, LogSplitResult } from "./logApi";
import {
  chooseSplitDish,
  openLog,
  openSplit,
  setSplitLine,
  submitSplit,
  type LogDeps,
  type LogNext,
  type LogState,
} from "./logScreenLogic";
import { MEALS, type Meal } from "./planApi";
import type { RangesResult } from "./targetsApi";

const T = "2026-03-10";

// The omelette of REQ-014/AC-010: 100 g egg white and 2 eggs.
const OMELETTE: Dish = {
  id: "d-omelette",
  name: "omelette",
  lines: [
    { position: 0, product: { id: "p-white", name: "egg white" }, grams: 100, pieces: null, weight_grams: 100 },
    { position: 1, product: { id: "p-egg", name: "egg" }, grams: null, pieces: 2, weight_grams: 100 },
  ],
  total_weight_grams: 200,
  replaced_by: null,
  deleted: false,
  selectable: true,
  has_unselectable_product: false,
};

function subject(id: string, name: string) {
  return { id, name, deleted: false, replaced: false };
}

function fake(opts: { refuse?: LogSplitResult; closed?: boolean } = {}) {
  const log: LogEntry[] = [];
  const split: { date: string; input: DishProductsInput }[] = [];
  const sheet = (date: string): LogDay => ({
    date,
    today: T,
    closed: false,
    editable: true,
    meals: MEALS.map((meal) => ({ meal, hasPlan: false, entries: log.filter((e) => e.meal === meal) })),
  });
  const api: LogApi & LogSplitApi = {
    async getDayLog(date) {
      return { kind: "ok", day: sheet(date) };
    },
    async addLogEntry() {
      return { kind: "failed", message: null };
    },
    async changeLogEntry() {
      return { kind: "failed", message: null };
    },
    async removeLogEntry() {
      return { kind: "failed", message: null };
    },
    async confirmMealAsPlanned() {
      return { kind: "failed", message: null };
    },
    async addLogDishProducts(date, input) {
      split.push({ date, input });
      if (opts.closed) return { kind: "refused", error: { code: "day.closed", reasons: [], message: null }, lines: [] };
      if (opts.refuse) return opts.refuse;
      const overrides = new Map((input.lines ?? []).map((l) => [l.position, l]));
      const entries: LogEntry[] = OMELETTE.lines.map((line, i) => {
        const o = overrides.get(line.position);
        const grams = o ? (o.grams ?? null) : line.grams;
        const pieces = o ? (o.pieces ?? null) : line.pieces;
        return {
          id: `e${log.length + i + 1}`,
          meal: input.meal,
          product: subject(line.product.id, line.product.name),
          dish: null,
          grams,
          pieces,
          weightGrams: grams ?? (pieces ?? 0) * 50,
          caloriesPer100: null,
        };
      });
      log.push(...entries);
      return { kind: "ok", entries };
    },
  };
  const dishWrites = { createDish: vi.fn(), editDish: vi.fn(), deleteDish: vi.fn(), restoreDish: vi.fn() };
  const listDishes = vi.fn(async (): Promise<DishListResult> => ({ kind: "ok", dishes: [OMELETTE] }));
  const deps: LogDeps = {
    log: api,
    targets: {
      getTargetRanges: async (): Promise<RangesResult> => ({
        kind: "ok",
        ranges: { as_of: T, setup_complete: true, calories: null, protein: null, fat: null },
      }),
    },
    products: { listProducts: async (): Promise<ListResult> => ({ kind: "ok", products: [] }) },
    dishes: { listDishes, ...dishWrites },
  };
  return { deps, split, dishWrites, listDishes };
}

async function opened(deps: LogDeps): Promise<LogState> {
  const o = await openLog(deps);
  if (o.kind !== "ok") throw new Error("log did not open");
  return o.state;
}

function stateOf(next: LogNext): LogState {
  if (next.kind !== "state") throw new Error("expected a state");
  return next.state;
}

function withDish(state: LogState, meal: Meal): LogState {
  return chooseSplitDish(openSplit(state, meal), meal, OMELETTE);
}

const formOf = (state: LogState, meal: Meal) => state.splits?.[`${T}|${meal}`];

describe("log screen controller: log a dish as products", () => {
  // cites: REQ-014/AC-005
  it("opens the form with the dish lines and the dish amounts prefilled", async () => {
    const { deps } = fake();
    const open = openSplit(await opened(deps), "dinner");
    expect(formOf(open, "dinner")?.dishId).toBe("");
    const chosen = chooseSplitDish(open, "dinner", OMELETTE);
    expect(formOf(chosen, "dinner")?.lines.map((l) => [l.position, l.name, l.grams, l.pieces])).toEqual([
      [0, "egg white", "100", ""],
      [1, "egg", "", "2"],
    ]);
  });

  // cites: REQ-014/AC-005
  it("saves a dish as separate product entries when no line is changed, with no lines in the request", async () => {
    const { deps, split } = fake();
    const next = stateOf(await submitSplit(deps, withDish(await opened(deps), "lunch"), "lunch"));
    expect(split[0]?.date).toBe(T);
    expect(split[0]?.input).toEqual({ meal: "lunch", dish_id: "d-omelette" });
    const lunch = next.day.meals.find((m) => m.meal === "lunch")?.entries ?? [];
    expect(lunch.map((e) => [e.product?.name, e.dish])).toEqual([
      ["egg white", null],
      ["egg", null],
    ]);
    expect(formOf(next, "lunch")).toBeUndefined();
    expect(next.error).toBeNull();
  });

  // cites: REQ-014/AC-010
  it("logs 150 g egg white and 2 eggs, sends only the changed line and makes no dish write", async () => {
    const { deps, split, dishWrites, listDishes } = fake();
    const typed = setSplitLine(withDish(await opened(deps), "lunch"), "lunch", 0, { grams: "150", pieces: "" });
    const same = setSplitLine(typed, "lunch", 1, { grams: "", pieces: "2" });
    const next = stateOf(await submitSplit(deps, same, "lunch"));
    expect(split.map((s) => s.input)).toEqual([
      { meal: "lunch", dish_id: "d-omelette", lines: [{ position: 0, grams: 150 }] },
    ]);
    const lunch = next.day.meals.find((m) => m.meal === "lunch")?.entries ?? [];
    expect(lunch.map((e) => [e.product?.name, e.grams, e.pieces])).toEqual([
      ["egg white", 150, null],
      ["egg", null, 2],
    ]);
    expect(dishWrites.createDish).not.toHaveBeenCalled();
    expect(dishWrites.editDish).not.toHaveBeenCalled();
    expect(dishWrites.deleteDish).not.toHaveBeenCalled();
    expect(dishWrites.restoreDish).not.toHaveBeenCalled();
    expect(listDishes).toHaveBeenCalledTimes(1);
  });

  // cites: REQ-014/AC-010
  it("treats a line typed back to the dish amount as unchanged", async () => {
    const { deps, split } = fake();
    const edited = setSplitLine(withDish(await opened(deps), "lunch"), "lunch", 0, { grams: "150", pieces: "" });
    const back = setSplitLine(edited, "lunch", 0, { grams: "100", pieces: "" });
    await submitSplit(deps, back, "lunch");
    expect(split[0]?.input.lines).toBeUndefined();
  });

  // cites: REQ-014/AC-010
  it("sends the other unit when a line is changed from grams to pieces", async () => {
    const { deps, split } = fake();
    const edited = setSplitLine(withDish(await opened(deps), "lunch"), "lunch", 0, { grams: "", pieces: "3" });
    await submitSplit(deps, edited, "lunch");
    expect(split[0]?.input.lines).toEqual([{ position: 0, pieces: 3 }]);
  });

  // cites: REQ-014/AC-005
  it("shows a per-line refusal naming the dish line, keeps the form as typed and saves nothing", async () => {
    const refuse: LogSplitResult = {
      kind: "refused",
      error: { code: "entry.invalid", reasons: [], message: null },
      lines: [{ index: 0, reason: "amount_invalid" }],
    };
    const { deps } = fake({ refuse });
    const typed = setSplitLine(withDish(await opened(deps), "lunch"), "lunch", 1, { grams: "", pieces: "0" });
    const next = stateOf(await submitSplit(deps, typed, "lunch"));
    expect(next.error?.code).toBe("entry.invalid");
    expect(next.error?.reasons).toEqual(["amount_invalid"]);
    expect(next.error?.text).toContain("Line 2 (egg)");
    expect(formOf(next, "lunch")?.refused).toEqual({ 1: "amount_invalid" });
    expect(formOf(next, "lunch")?.lines.map((l) => [l.grams, l.pieces])).toEqual([
      ["100", ""],
      ["", "0"],
    ]);
    expect(next.day.meals.find((m) => m.meal === "lunch")?.entries).toEqual([]);
  });

  // cites: REQ-014/AC-005
  it("refuses the split on a closed day and keeps the form as typed", async () => {
    const { deps } = fake({ closed: true });
    const typed = setSplitLine(withDish(await opened(deps), "lunch"), "lunch", 0, { grams: "150", pieces: "" });
    const next = stateOf(await submitSplit(deps, typed, "lunch"));
    expect(next.error?.code).toBe("day.closed");
    expect(formOf(next, "lunch")?.lines[0]?.grams).toBe("150");
    expect(next.day.meals.find((m) => m.meal === "lunch")?.entries).toEqual([]);
  });

  // cites: REQ-014/AC-005
  it("goes to login on 401", async () => {
    const { deps } = fake({ refuse: { kind: "unauthorized" } });
    const next = await submitSplit(deps, withDish(await opened(deps), "lunch"), "lunch");
    expect(next.kind).toBe("unauthorized");
  });
});
