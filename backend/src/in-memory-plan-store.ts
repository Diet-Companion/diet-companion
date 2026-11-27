import { type DayCloser, type DayRange } from "./day-close.js";
import {
  DayClosedError,
  sortEntries,
  type EntryKind,
  type Meal,
  type NewStoredEntry,
  type PlanDay,
  type PlanStore,
  type PlanTx,
  type StoredEntry,
} from "./plan-store.js";

interface Row {
  day: string;
  kind: EntryKind;
  entry: StoredEntry;
}

/** A fake PlanStore (and DayCloser) for unit tests. It follows the contract of PlanStore, including the rollback on a throw. */
export class InMemoryPlanStore implements PlanStore, DayCloser {
  private rows: Row[] = [];
  private readonly days = new Map<string, { closed_at: Date | null }>();
  private readonly ranges = new Map<string, DayRange[]>();

  constructor(private readonly newId: () => string) {}

  /** Test seed: marks a day closed without stored ranges (ADR-019/C-002). Closing for real goes through closeDay. */
  seedClosed(day: string, at: Date = new Date(0)): void {
    this.days.set(day, { closed_at: at });
  }

  async read(day: string, kind: EntryKind = "plan"): Promise<PlanDay> {
    return {
      closed: this.days.get(day)?.closed_at != null,
      entries: sortEntries(this.rows.filter((r) => r.day === day && r.kind === kind).map((r) => r.entry)),
    };
  }

  async closeDay(day: string, at: Date, resolveRanges: () => Promise<DayRange[]>): Promise<void> {
    if (this.days.get(day)?.closed_at != null) throw new DayClosedError();
    const hadDay = this.days.has(day);
    if (!hadDay) this.days.set(day, { closed_at: null });
    try {
      const resolved = await resolveRanges();
      if (this.days.get(day)?.closed_at != null) throw new DayClosedError();
      this.ranges.set(
        day,
        resolved.map((r) => ({ ...r })),
      );
      this.days.set(day, { closed_at: at });
    } catch (error) {
      if (!hadDay) this.days.delete(day);
      throw error;
    }
  }

  async closedAt(day: string): Promise<Date | null> {
    return this.days.get(day)?.closed_at ?? null;
  }

  async closedRanges(day: string): Promise<DayRange[]> {
    return (this.ranges.get(day) ?? []).map((r) => ({ ...r }));
  }

  async closedDays(from: string, before: string): Promise<string[]> {
    return [...this.days.entries()]
      .filter(([day, row]) => row.closed_at != null && day >= from && day < before)
      .map(([day]) => day)
      .sort();
  }

  async firstRecordedDay(): Promise<string | undefined> {
    return [...this.days.keys()].sort()[0];
  }

  async mutate<T>(day: string, _at: Date, work: (tx: PlanTx) => Promise<T>, kind: EntryKind = "plan"): Promise<T> {
    if (this.days.get(day)?.closed_at != null) throw new DayClosedError();
    const before = this.rows;
    const hadDay = this.days.has(day);
    if (!hadDay) this.days.set(day, { closed_at: null });
    try {
      return await work(this.tx(day, kind));
    } catch (error) {
      // Rows are replaced, never edited in place, so the old array is a full snapshot.
      this.rows = before;
      if (!hadDay) this.days.delete(day);
      throw error;
    }
  }

  private tx(day: string, kind: EntryKind): PlanTx {
    const own = (r: Row): boolean => r.day === day && r.kind === kind;
    return {
      add: async (entry: NewStoredEntry): Promise<StoredEntry> => {
        const same = this.rows.filter((r) => own(r) && r.entry.meal === entry.meal);
        const position = same.reduce((max, r) => Math.max(max, r.entry.position + 1), 0);
        const saved: StoredEntry = { ...entry, id: this.newId(), position };
        this.rows = [...this.rows, { day, kind, entry: saved }];
        return saved;
      },
      find: async (id: string): Promise<StoredEntry | undefined> => this.rows.find((r) => own(r) && r.entry.id === id)?.entry,
      setAmount: async (id, amount): Promise<StoredEntry | undefined> => {
        const found = this.rows.find((r) => own(r) && r.entry.id === id);
        if (!found) return undefined;
        const changed: StoredEntry = { ...found.entry, grams: amount.grams, pieces: amount.pieces };
        this.rows = this.rows.map((r) => (r === found ? { day, kind, entry: changed } : r));
        return changed;
      },
      remove: async (id: string): Promise<boolean> => {
        const found = this.rows.find((r) => own(r) && r.entry.id === id);
        if (!found) return false;
        this.rows = this.rows.filter((r) => r !== found);
        return true;
      },
      list: async (meal: Meal, other: EntryKind = kind): Promise<StoredEntry[]> =>
        sortEntries(this.rows.filter((r) => r.day === day && r.kind === other && r.entry.meal === meal).map((r) => r.entry)),
    };
  }
}
