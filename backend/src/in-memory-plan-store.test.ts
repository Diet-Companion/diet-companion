import { describe, expect, it } from "vitest";
import { InMemoryPlanStore } from "./in-memory-plan-store.js";
import { DayClosedError, type NewStoredEntry } from "./plan-store.js";

const at = new Date("2026-03-10T10:00:00Z");

function setup(): InMemoryPlanStore {
  let n = 0;
  return new InMemoryPlanStore(() => `e${++n}`);
}

const rice = (meal: NewStoredEntry["meal"], grams = 100): NewStoredEntry => ({
  meal,
  product_id: "p1",
  dish_id: null,
  grams,
  pieces: null,
  from_dish_id: null,
});

describe("InMemoryPlanStore (the PlanStore fake)", () => {
  // cites: REQ-013/AC-007, ADR-019/C-002
  it("refuses a change on a closed day before the work runs, and still reads the day", async () => {
    const store = setup();
    await store.mutate("2026-03-10", at, (tx) => tx.add(rice("lunch")));
    store.seedClosed("2026-03-10");
    let ran = false;
    await expect(
      store.mutate("2026-03-10", at, async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(DayClosedError);
    expect(ran).toBe(false);
    const day = await store.read("2026-03-10");
    expect(day.closed).toBe(true);
    expect(day.entries).toHaveLength(1);
  });

  // cites: REQ-013/AC-006, ADR-017/C-004
  it("saves nothing and makes no day row when the work throws", async () => {
    const store = setup();
    await expect(
      store.mutate("2026-03-11", at, async (tx) => {
        await tx.add(rice("lunch"));
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    expect(await store.read("2026-03-11")).toEqual({ closed: false, entries: [] });
  });

  // cites: ADR-017/C-002
  it("gives each entry a new id and the next position of its meal, and keeps the order after a removal", async () => {
    const store = setup();
    const [a, b, c] = await store.mutate("2026-03-10", at, async (tx) => [
      await tx.add(rice("lunch")),
      await tx.add(rice("lunch", 200)),
      await tx.add(rice("breakfast", 50)),
    ]);
    expect([a?.position, b?.position, c?.position]).toEqual([0, 1, 0]);
    await store.mutate("2026-03-10", at, (tx) => tx.remove(a?.id ?? ""));
    const day = await store.read("2026-03-10");
    expect(day.entries.map((e) => [e.meal, e.id])).toEqual([
      ["breakfast", c?.id],
      ["lunch", b?.id],
    ]);
    const added = await store.mutate("2026-03-10", at, (tx) => tx.add(rice("lunch", 10)));
    expect(added.position).toBe(2);
  });

  // cites: ADR-017/C-002
  it("changes only the amount of an entry", async () => {
    const store = setup();
    const added = await store.mutate("2026-03-10", at, (tx) => tx.add(rice("dinner")));
    const changed = await store.mutate("2026-03-10", at, (tx) => tx.setAmount(added.id, { grams: 250, pieces: null }));
    expect(changed).toEqual({ ...added, grams: 250 });
    expect(await store.mutate("2026-03-10", at, (tx) => tx.setAmount("missing", { grams: 1, pieces: null }))).toBeUndefined();
  });
});
