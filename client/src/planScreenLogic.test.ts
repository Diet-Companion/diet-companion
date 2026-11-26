import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListResult } from "./api";
import type { DishListResult } from "./dishApi";
import {
  MEALS,
  type AmountInput,
  type DayResult,
  type DaySheet,
  type EntryResult,
  type NewEntryInput,
  type PlanApi,
  type PlanEntry,
  type PlanError,
  type RemoveResult,
} from "./planApi";
import { changeAmount, openPlan, removeEntry, setForm, submitEntry, type Next, type PlanDeps, type PlanState } from "./planScreenLogic";
import type { RangesResult } from "./targetsApi";

const NAMES: Record<string, string> = { "p-rice": "rice", "d-omelette": "omelette" };

function subject(id: string | undefined) {
  return id ? { id, name: NAMES[id] ?? id, deleted: false, replaced: false } : null;
}

function refusal(code: string, reasons: string[] = []): PlanError {
  return { code, reasons, message: null };
}

function fake(opts: { today?: string; closed?: string[] } = {}) {
  const server = { today: opts.today ?? "2026-03-10", closed: new Set(opts.closed ?? []), refuse: null as PlanError | null };
  const entries: Record<string, PlanEntry[]> = {};
  const calls = {
    get: [] as string[],
    add: [] as { date: string; input: NewEntryInput }[],
    change: [] as { date: string; id: string; amount: AmountInput }[],
    remove: [] as string[],
  };
  let n = 0;
  function sheet(date: string): DaySheet {
    const list = entries[date] ?? [];
    const closed = server.closed.has(date);
    return {
      date,
      today: server.today,
      closed,
      editable: !closed,
      meals: MEALS.map((meal) => ({ meal, entries: list.filter((e) => e.meal === meal) })),
    };
  }
  const plan: PlanApi = {
    async getDayPlan(date): Promise<DayResult> {
      calls.get.push(date);
      return { kind: "ok", sheet: sheet(date) };
    },
    async addPlanEntry(date, input): Promise<EntryResult> {
      calls.add.push({ date, input });
      if (server.refuse) return { kind: "refused", error: server.refuse };
      n += 1;
      const entry: PlanEntry = {
        id: `e${n}`,
        meal: input.meal,
        product: subject(input.product_id),
        dish: subject(input.dish_id),
        grams: input.grams ?? null,
        pieces: input.pieces ?? null,
      };
      entries[date] = [...(entries[date] ?? []), entry];
      return { kind: "ok", entry };
    },
    async changePlanEntry(date, id, amount): Promise<EntryResult> {
      calls.change.push({ date, id, amount });
      if (server.refuse) return { kind: "refused", error: server.refuse };
      const found = (entries[date] ?? []).find((e) => e.id === id);
      if (!found) return { kind: "failed", message: null };
      found.grams = amount.grams ?? found.grams;
      found.pieces = amount.pieces ?? found.pieces;
      return { kind: "ok", entry: found };
    },
    async removePlanEntry(date, id): Promise<RemoveResult> {
      calls.remove.push(id);
      if (server.refuse) return { kind: "refused", error: server.refuse };
      entries[date] = (entries[date] ?? []).filter((e) => e.id !== id);
      return { kind: "ok" };
    },
  };
  const deps: PlanDeps = {
    plan,
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
  return { server, calls, deps, entries };
}

async function opened(deps: PlanDeps): Promise<PlanState> {
  const o = await openPlan(deps);
  if (o.kind !== "ok") throw new Error("plan did not open");
  return o.state;
}

function stateOf(next: Next): PlanState {
  if (next.kind !== "state") throw new Error("expected a state");
  return next.state;
}

function typed(state: PlanState, date: string, meal: (typeof MEALS)[number], subject: string, grams = "", pieces = "") {
  return setForm(state, date, meal, { subject, grams, pieces });
}

function entriesOf(state: PlanState, date: string, meal: string): PlanEntry[] {
  const day = state.days.find((d) => d.date === date);
  return day?.meals.find((m) => m.meal === meal)?.entries ?? [];
}

afterEach(() => {
  vi.useRealTimers();
});

describe("plan screen controller", () => {
  // cites: ADR-016/C-003, REQ-013/AC-004
  it("reads as_of first, never the device clock, and shows only today and the next day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-07-01T12:00:00Z"));
    const { calls, deps } = fake({ today: "2026-03-10" });
    const state = await opened(deps);
    expect(calls.get).toEqual(["2026-03-10", "2026-03-11"]);
    expect(state.days.map((d) => d.date)).toEqual(["2026-03-10", "2026-03-11"]);
    expect(state.today).toBe("2026-03-10");
  });

  // cites: ADR-016/C-003
  it("takes today from the day responses on later reads", async () => {
    const { server, calls, deps } = fake({ today: "2026-03-10" });
    let state = await opened(deps);
    server.today = "2026-03-11";
    state = typed(state, "2026-03-11", "lunch", "p:p-rice", "100");
    state = stateOf(await submitEntry(deps, state, "2026-03-11", "lunch"));
    expect(calls.get.slice(2)).toEqual(["2026-03-10", "2026-03-11", "2026-03-12"]);
    expect(state.today).toBe("2026-03-11");
    expect(state.days.map((d) => d.date)).toEqual(["2026-03-11", "2026-03-12"]);
  });

  // cites: REQ-013/AC-001
  it("adds a whole dish at breakfast and 100 g of rice at lunch to tomorrow", async () => {
    const { deps, calls } = fake();
    let state = await opened(deps);
    state = typed(state, "2026-03-11", "breakfast", "d:d-omelette");
    state = stateOf(await submitEntry(deps, state, "2026-03-11", "breakfast"));
    state = typed(state, "2026-03-11", "lunch", "p:p-rice", "100");
    state = stateOf(await submitEntry(deps, state, "2026-03-11", "lunch"));
    expect(calls.add[0]).toEqual({ date: "2026-03-11", input: { meal: "breakfast", dish_id: "d-omelette" } });
    expect(calls.add[1]).toEqual({ date: "2026-03-11", input: { meal: "lunch", product_id: "p-rice", grams: 100 } });
    expect(entriesOf(state, "2026-03-11", "breakfast")[0]?.dish?.name).toBe("omelette");
    expect(entriesOf(state, "2026-03-11", "lunch")[0]?.grams).toBe(100);
    expect(state.error).toBeNull();
  });

  // cites: REQ-013/AC-002
  it("saves a next-day plan while today is not closed", async () => {
    const { deps, calls } = fake();
    let state = await opened(deps);
    expect(state.days[0]?.closed).toBe(false);
    state = typed(state, "2026-03-11", "dinner", "p:p-rice", "80");
    state = stateOf(await submitEntry(deps, state, "2026-03-11", "dinner"));
    expect(calls.add).toHaveLength(1);
    expect(entriesOf(state, "2026-03-11", "dinner")).toHaveLength(1);
    expect(state.error).toBeNull();
  });

  // cites: REQ-013/AC-003, R-013
  it("does not block next-day planning when today and an earlier day are not closed", async () => {
    const { deps, calls } = fake({ closed: ["2026-03-09"] });
    let state = await opened(deps);
    state = typed(state, "2026-03-11", "brunch", "p:p-rice", "50");
    state = stateOf(await submitEntry(deps, state, "2026-03-11", "brunch"));
    expect(calls.add[0]?.date).toBe("2026-03-11");
    expect(entriesOf(state, "2026-03-11", "brunch")).toHaveLength(1);
    expect(state.error).toBeNull();
  });

  // cites: REQ-013/AC-004
  it("shows the server refusal for a day out of range and saves nothing", async () => {
    const { deps, server } = fake();
    let state = await opened(deps);
    server.refuse = refusal("plan.day_out_of_range");
    state = typed(state, "2026-03-12", "lunch", "p:p-rice", "100");
    state = stateOf(await submitEntry(deps, state, "2026-03-12", "lunch"));
    expect(state.error?.code).toBe("plan.day_out_of_range");
    expect(state.days.map((d) => d.date)).toEqual(["2026-03-10", "2026-03-11"]);
  });

  // cites: REQ-013/AC-005
  it("sends 150 g and shows the saved entry", async () => {
    const { deps, calls } = fake();
    let state = await opened(deps);
    state = typed(state, "2026-03-10", "lunch", "p:p-rice", "150");
    state = stateOf(await submitEntry(deps, state, "2026-03-10", "lunch"));
    expect(calls.add[0]?.input.grams).toBe(150);
    expect(entriesOf(state, "2026-03-10", "lunch")[0]?.grams).toBe(150);
    expect(state.error).toBeNull();
  });

  // cites: REQ-013/AC-006, A-008
  it("shows the refusal of 150.5 g, keeps the form as typed and changes nothing", async () => {
    const { deps, server, calls } = fake();
    let state = await opened(deps);
    server.refuse = refusal("entry.invalid", ["amount_invalid"]);
    state = typed(state, "2026-03-10", "lunch", "p:p-rice", "150.5");
    state = stateOf(await submitEntry(deps, state, "2026-03-10", "lunch"));
    expect(calls.add[0]?.input.grams).toBe(150.5);
    expect(state.error?.code).toBe("entry.invalid");
    expect(state.error?.reasons).toEqual(["amount_invalid"]);
    expect(state.forms["2026-03-10|lunch"]?.grams).toBe("150.5");
    expect(entriesOf(state, "2026-03-10", "lunch")).toHaveLength(0);
  });

  // cites: REQ-013/AC-007, R-013
  it("shows the refusal for a closed day and keeps the form", async () => {
    const { deps, server } = fake({ closed: ["2026-03-10"] });
    let state = await opened(deps);
    server.refuse = refusal("day.closed");
    state = typed(state, "2026-03-10", "dinner", "p:p-rice", "90");
    state = stateOf(await submitEntry(deps, state, "2026-03-10", "dinner"));
    expect(state.error?.code).toBe("day.closed");
    expect(state.forms["2026-03-10|dinner"]?.grams).toBe("90");
    expect(entriesOf(state, "2026-03-10", "dinner")).toHaveLength(0);
  });

  // cites: REQ-013/AC-008, R-007
  it("shows the refusal of pieces without a piece weight and changes nothing", async () => {
    const { deps, server, calls } = fake();
    let state = await opened(deps);
    server.refuse = refusal("entry.invalid", ["piece_without_weight"]);
    state = typed(state, "2026-03-10", "lunch", "p:p-rice", "", "2");
    state = stateOf(await submitEntry(deps, state, "2026-03-10", "lunch"));
    expect(calls.add[0]?.input).toEqual({ meal: "lunch", product_id: "p-rice", pieces: 2 });
    expect(state.error?.reasons).toEqual(["piece_without_weight"]);
    expect(state.forms["2026-03-10|lunch"]?.pieces).toBe("2");
    expect(entriesOf(state, "2026-03-10", "lunch")).toHaveLength(0);
  });

  // cites: IF-001@1.5.0#changePlanEntry, IF-001@1.5.0#removePlanEntry
  it("changes an amount in its own unit and removes an entry", async () => {
    const { deps, calls } = fake();
    let state = await opened(deps);
    state = typed(state, "2026-03-10", "lunch", "p:p-rice", "100");
    state = stateOf(await submitEntry(deps, state, "2026-03-10", "lunch"));
    const entry = entriesOf(state, "2026-03-10", "lunch")[0];
    if (!entry) throw new Error("no entry");
    state = { ...state, edits: { [entry.id]: "200" } };
    state = stateOf(await changeAmount(deps, state, "2026-03-10", entry));
    expect(calls.change[0]).toEqual({ date: "2026-03-10", id: entry.id, amount: { grams: 200 } });
    expect(entriesOf(state, "2026-03-10", "lunch")[0]?.grams).toBe(200);
    state = stateOf(await removeEntry(deps, state, "2026-03-10", entry));
    expect(calls.remove).toEqual([entry.id]);
    expect(entriesOf(state, "2026-03-10", "lunch")).toHaveLength(0);
  });

  // cites: IF-001@1.5.0#getDayPlan
  it("reports unauthorized when the day read is refused for login", async () => {
    const { deps } = fake();
    deps.plan.getDayPlan = async () => ({ kind: "unauthorized" });
    expect((await openPlan(deps)).kind).toBe("unauthorized");
  });
});
