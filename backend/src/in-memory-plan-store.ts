import {
  DayClosedError,
  sortEntries,
  type NewStoredEntry,
  type PlanDay,
  type PlanStore,
  type PlanTx,
  type StoredEntry,
} from "./plan-store.js";

interface Row {
  day: string;
  entry: StoredEntry;
}

/** A fake PlanStore for unit tests. It follows the contract of PlanStore, including the rollback on a throw. */
export class InMemoryPlanStore implements PlanStore {
  private rows: Row[] = [];
  private readonly days = new Map<string, { closed_at: Date | null }>();

  constructor(private readonly newId: () => string) {}

  /** Test seed: marks a day closed, as the closing feature of REQ-011 will (ADR-019/C-002). */
  seedClosed(day: string, at: Date = new Date(0)): void {
    this.days.set(day, { closed_at: at });
  }

  async read(day: string): Promise<PlanDay> {
    return {
      closed: this.days.get(day)?.closed_at != null,
      entries: sortEntries(this.rows.filter((r) => r.day === day).map((r) => r.entry)),
    };
  }

  async mutate<T>(day: string, _at: Date, work: (tx: PlanTx) => Promise<T>): Promise<T> {
    if (this.days.get(day)?.closed_at != null) throw new DayClosedError();
    const before = this.rows;
    const hadDay = this.days.has(day);
    if (!hadDay) this.days.set(day, { closed_at: null });
    try {
      return await work(this.tx(day));
    } catch (error) {
      // Rows are replaced, never edited in place, so the old array is a full snapshot.
      this.rows = before;
      if (!hadDay) this.days.delete(day);
      throw error;
    }
  }

  private tx(day: string): PlanTx {
    return {
      add: async (entry: NewStoredEntry): Promise<StoredEntry> => {
        const same = this.rows.filter((r) => r.day === day && r.entry.meal === entry.meal);
        const position = same.reduce((max, r) => Math.max(max, r.entry.position + 1), 0);
        const saved: StoredEntry = { ...entry, id: this.newId(), position };
        this.rows = [...this.rows, { day, entry: saved }];
        return saved;
      },
      find: async (id: string): Promise<StoredEntry | undefined> =>
        this.rows.find((r) => r.day === day && r.entry.id === id)?.entry,
      setAmount: async (id, amount): Promise<StoredEntry | undefined> => {
        const found = this.rows.find((r) => r.day === day && r.entry.id === id);
        if (!found) return undefined;
        const changed: StoredEntry = { ...found.entry, grams: amount.grams, pieces: amount.pieces };
        this.rows = this.rows.map((r) => (r === found ? { day, entry: changed } : r));
        return changed;
      },
      remove: async (id: string): Promise<boolean> => {
        const found = this.rows.find((r) => r.day === day && r.entry.id === id);
        if (!found) return false;
        this.rows = this.rows.filter((r) => r !== found);
        return true;
      },
    };
  }
}
