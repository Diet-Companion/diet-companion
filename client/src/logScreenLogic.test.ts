import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListResult } from "./api";
import type { DishListResult } from "./dishApi";
import type { LogApi, LogDay, LogEntry } from "./logApi";
import {
  changeAmount,
  confirmMeal,
  earlierDay,
  laterDay,
  openLog,
  removeEntry,
  setEdit,
  setForm,
  submitEntry,
  type LogDeps,
  type LogNext,
  type LogState,
} from "./logScreenLogic";
import { MEALS, type AmountInput, type Meal, type NewEntryInput, type PlanError } from "./planApi";
import type { RangesResult } from "./targetsApi";

const NAMES: Record<string, string> = {
  "p-rice": "rice",
  "p-chicken": "chicken",
  "p-soup": "soup",
  "p-egg": "egg",
  "p-bare": "bare",
  "p-choc": "chocolate",
  "p-oat": "oatmeal",
  "p-apple": "apple",
  "d-omelette": "omelette",
};

function subject(id: string | undefined) {
  return id ? { id, name: NAMES[id] ?? id, deleted: false, replaced: false } : null;
}

function refusal(code: string, reasons: string[] = []): PlanError {
  return { code, reasons, message: null };
}

function planned(id: string, meal: Meal, product: string, grams: number): LogEntry {
  return { id, meal, product: subject(product), dish: null, grams, pieces: null, weightGrams: grams, caloriesPer100: null };
}

const T = "2026-03-10";
const key = (date: string, meal: Meal) => `${date}|${meal}`;

function fake(opts: { today?: string; closed?: string[]; plan?: Record<string, LogEntry[]> } = {}) {
  const server = { today: opts.today ?? T, closed: new Set(opts.closed ?? []) };
  const plan = opts.plan ?? {};
  const log: Record<string, LogEntry[]> = {};
  const calls = {
    get: [] as string[],
    add: [] as { date: string; input: NewEntryInput }[],
    change: [] as { date: string; id: string; amount: AmountInput }[],
    remove: [] as string[],
    confirm: [] as string[],
  };
  let n = 0;
  function sheet(date: string): LogDay {
    const closed = server.closed.has(date);
    return {
      date,
      today: server.today,
      closed,
      editable: !closed && date <= server.today,
      meals: MEALS.map((meal) => ({
        meal,
        hasPlan: (plan[key(date, meal)] ?? []).length > 0,
        entries: (log[date] ?? []).filter((e) => e.meal === meal),
      })),
    };
  }
  function make(meal: Meal, input: NewEntryInput): LogEntry {
    n += 1;
    const pieces = input.pieces ?? null;
    return {
      id: `e${n}`,
      meal,
      product: subject(input.product_id),
      dish: subject(input.dish_id),
      grams: input.grams ?? null,
      pieces,
      weightGrams: pieces !== null ? pieces * 50 : (input.grams ?? null),
      caloriesPer100: input.product_id ? 140 : null,
    };
  }
  const closedRefusal = (date: string) => (server.closed.has(date) ? refusal("day.closed") : null);
  const api: LogApi = {
    async getDayLog(date) {
      calls.get.push(date);
      return { kind: "ok", day: sheet(date) };
    },
    async addLogEntry(date, input) {
      calls.add.push({ date, input });
      const closed = closedRefusal(date);
      if (closed) return { kind: "refused", error: closed };
      if (input.pieces !== undefined && input.product_id === "p-bare") {
        return { kind: "refused", error: refusal("entry.invalid", ["piece_without_weight"]) };
      }
      const entry = make(input.meal, input);
      log[date] = [...(log[date] ?? []), entry];
      return { kind: "ok", entry };
    },
    async changeLogEntry(date, id, amount) {
      calls.change.push({ date, id, amount });
      const closed = closedRefusal(date);
      if (closed) return { kind: "refused", error: closed };
      const found = (log[date] ?? []).find((e) => e.id === id);
      if (!found) return { kind: "failed", message: null };
      found.grams = amount.grams ?? found.grams;
      found.weightGrams = amount.grams ?? found.weightGrams;
      return { kind: "ok", entry: found };
    },
    async removeLogEntry(date, id) {
      calls.remove.push(id);
      const closed = closedRefusal(date);
      if (closed) return { kind: "refused", error: closed };
      log[date] = (log[date] ?? []).filter((e) => e.id !== id);
      return { kind: "ok" };
    },
    async confirmMealAsPlanned(date, meal) {
      calls.confirm.push(key(date, meal));
      const closed = closedRefusal(date);
      if (closed) return { kind: "refused", error: closed };
      const source = plan[key(date, meal)] ?? [];
      if (source.length === 0) return { kind: "refused", error: refusal("plan.meal_empty") };
      const copies = source.map((p) => ({ ...p, id: `c${(n += 1)}` }));
      log[date] = [...(log[date] ?? []), ...copies];
      return { kind: "ok", entries: copies };
    },
  };
  const deps: LogDeps = {
    log: api,
    targets: {
      getTargetRanges: async (): Promise<RangesResult> => ({
        kind: "ok",
        ranges: { as_of: server.today, setup_complete: true, calories: null, protein: null, fat: null },
      }),
    },
    products: {
      listProducts: async (): Promise<ListResult> => ({
        kind: "ok",
        products: [{ id: "p-rice", name: "rice", shop: "shop", calories: 130, protein: 3, fat: 1, source: "manual" }],
      }),
    },
    dishes: {
      listDishes: async (): Promise<DishListResult> => ({
        kind: "ok",
        dishes: [
          {
            id: "d-omelette",
            name: "omelette",
            lines: [],
            total_weight_grams: 0,
            replaced_by: null,
            deleted: false,
            selectable: true,
            has_unselectable_product: false,
          },
        ],
      }),
    },
  };
  return { server, calls, deps, log, plan };
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

function typed(state: LogState, meal: Meal, subjectValue: string, grams = "", pieces = "") {
  return setForm(state, meal, { subject: subjectValue, grams, pieces });
}

function entriesOf(state: LogState, meal: Meal): LogEntry[] {
  return state.day.meals.find((m) => m.meal === meal)?.entries ?? [];
}

afterEach(() => {
  vi.useRealTimers();
});

describe("log screen controller", () => {
  // cites: ADR-016/C-003, REQ-014/AC-013
  it("opens on the server's today, never the device clock, with has_plan of each meal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-07-01T12:00:00Z"));
    const { calls, deps } = fake({ plan: { [key(T, "breakfast")]: [planned("x1", "breakfast", "p-oat", 40)] } });
    const state = await opened(deps);
    expect(calls.get).toEqual([T]);
    expect(state.day.date).toBe(T);
    expect(state.day.meals.map((m) => m.hasPlan)).toEqual([true, false, false, false, false]);
  });

  // cites: REQ-014/AC-001
  it("copies the plan of a meal into the log and leaves the plan as it was", async () => {
    const { calls, deps, plan } = fake({
      plan: { [key(T, "lunch")]: [planned("x1", "lunch", "p-rice", 100), planned("x2", "lunch", "p-chicken", 150)] },
    });
    const next = stateOf(await confirmMeal(deps, await opened(deps), "lunch"));
    expect(calls.confirm).toEqual([key(T, "lunch")]);
    expect(entriesOf(next, "lunch").map((e) => [e.product?.name, e.grams])).toEqual([
      ["rice", 100],
      ["chicken", 150],
    ]);
    expect(plan[key(T, "lunch")]?.map((e) => e.grams)).toEqual([100, 150]);
  });

  // cites: REQ-014/AC-002
  it("changes the amount of an entry copied from the plan and the plan stays unchanged", async () => {
    const { calls, deps, plan } = fake({ plan: { [key(T, "lunch")]: [planned("x1", "lunch", "p-rice", 100)] } });
    const confirmed = stateOf(await confirmMeal(deps, await opened(deps), "lunch"));
    const copy = entriesOf(confirmed, "lunch")[0];
    if (!copy) throw new Error("no copy");
    const next = stateOf(await changeAmount(deps, setEdit(confirmed, copy.id, "80"), copy));
    expect(calls.change[0]?.amount).toEqual({ grams: 80 });
    expect(entriesOf(next, "lunch")[0]?.grams).toBe(80);
    expect(plan[key(T, "lunch")]?.[0]?.grams).toBe(100);
  });

  // cites: REQ-014/AC-003
  it("enters a meal from scratch so that the log holds only what was entered", async () => {
    const { calls, deps } = fake({ plan: { [key(T, "lunch")]: [planned("x1", "lunch", "p-rice", 100)] } });
    const state = typed(await opened(deps), "lunch", "p:p-soup", "200");
    const next = stateOf(await submitEntry(deps, state, "lunch"));
    expect(calls.add[0]).toEqual({ date: T, input: { meal: "lunch", product_id: "p-soup", grams: 200 } });
    expect(entriesOf(next, "lunch").map((e) => [e.product?.name, e.grams])).toEqual([["soup", 200]]);
    expect(next.forms[`${T}|lunch`]).toBeUndefined();
  });

  // cites: REQ-014/AC-004
  it("logs a whole dish without an amount", async () => {
    const { calls, deps } = fake();
    const state = typed(await opened(deps), "dinner", "d:d-omelette", "999", "9");
    const next = stateOf(await submitEntry(deps, state, "dinner"));
    expect(calls.add[0]?.input).toEqual({ meal: "dinner", dish_id: "d-omelette" });
    expect(entriesOf(next, "dinner")[0]?.dish?.name).toBe("omelette");
  });

  // cites: REQ-014/AC-006
  it("saves chocolate at a breakfast planned with only oatmeal, with no limit or warning", async () => {
    const { deps } = fake({ plan: { [key(T, "breakfast")]: [planned("x1", "breakfast", "p-oat", 40)] } });
    const state = typed(await opened(deps), "breakfast", "p:p-choc", "50");
    const next = stateOf(await submitEntry(deps, state, "breakfast"));
    expect(entriesOf(next, "breakfast").map((e) => e.product?.name)).toEqual(["chocolate"]);
    expect(next.error).toBeNull();
  });

  // cites: REQ-014/AC-007
  it("keeps an apple planned for brunch at lunch when it is logged at lunch", async () => {
    const { calls, deps } = fake({ plan: { [key(T, "brunch")]: [planned("x1", "brunch", "p-apple", 100)] } });
    const state = typed(await opened(deps), "lunch", "p:p-apple", "100");
    const next = stateOf(await submitEntry(deps, state, "lunch"));
    expect(calls.add[0]?.input.meal).toBe("lunch");
    expect(entriesOf(next, "lunch").map((e) => e.product?.name)).toEqual(["apple"]);
    expect(entriesOf(next, "brunch")).toEqual([]);
  });

  // cites: REQ-014/AC-008
  it("shows the weight and nutrients of 2 eggs as the response gives them", async () => {
    const { calls, deps } = fake();
    const state = typed(await opened(deps), "lunch", "p:p-egg", "", "2");
    const next = stateOf(await submitEntry(deps, state, "lunch"));
    expect(calls.add[0]?.input).toEqual({ meal: "lunch", product_id: "p-egg", pieces: 2 });
    expect(entriesOf(next, "lunch")[0]?.pieces).toBe(2);
    expect(entriesOf(next, "lunch")[0]?.weightGrams).toBe(100);
    expect(entriesOf(next, "lunch")[0]?.caloriesPer100).toBe(140);
  });

  // cites: REQ-014/AC-009
  it("shows the refusal for pieces without a piece weight and keeps the form as typed", async () => {
    const { deps } = fake();
    const state = typed(await opened(deps), "lunch", "p:p-bare", "", "2");
    const next = stateOf(await submitEntry(deps, state, "lunch"));
    expect(next.error?.code).toBe("entry.invalid");
    expect(next.error?.reasons).toEqual(["piece_without_weight"]);
    expect(next.error?.text).toContain("piece weight");
    expect(next.forms[`${T}|lunch`]).toEqual({ subject: "p:p-bare", grams: "", pieces: "2" });
    expect(entriesOf(next, "lunch")).toEqual([]);
  });

  // cites: REQ-014/AC-011
  it("refuses every change on a closed day and keeps the form as typed", async () => {
    const { deps } = fake({ closed: [T], plan: { [key(T, "lunch")]: [planned("x1", "lunch", "p-rice", 100)] } });
    const state = typed(await opened(deps), "lunch", "p:p-soup", "200");
    const added = stateOf(await submitEntry(deps, state, "lunch"));
    expect(added.error?.code).toBe("day.closed");
    expect(added.forms[`${T}|lunch`]?.grams).toBe("200");
    expect(entriesOf(added, "lunch")).toEqual([]);
    expect(stateOf(await confirmMeal(deps, state, "lunch")).error?.code).toBe("day.closed");
  });

  // cites: REQ-014/AC-002
  it("removes an entry", async () => {
    const { calls, deps } = fake();
    const added = stateOf(await submitEntry(deps, typed(await opened(deps), "lunch", "p:p-soup", "200"), "lunch"));
    const entry = entriesOf(added, "lunch")[0];
    if (!entry) throw new Error("no entry");
    const next = stateOf(await removeEntry(deps, added, entry));
    expect(calls.remove).toEqual([entry.id]);
    expect(entriesOf(next, "lunch")).toEqual([]);
  });

  // cites: REQ-014/AC-013, ADR-016/C-003
  it("moves to earlier days, offers no day after today, and reads only what it shows", async () => {
    const { calls, deps } = fake();
    const today = await opened(deps);
    const same = stateOf(await laterDay(deps, today));
    expect(same.day.date).toBe(T);
    expect(calls.get).toEqual([T]);
    const earlier = stateOf(await earlierDay(deps, today));
    expect(earlier.day.date).toBe("2026-03-09");
    expect(calls.get).toEqual([T, "2026-03-09"]);
    expect(stateOf(await laterDay(deps, earlier)).day.date).toBe(T);
  });
});
