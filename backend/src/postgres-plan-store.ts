import type pg from "pg";
import type { DayCloser, DayRange } from "./day-close.js";
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

const COLUMNS = "id, meal, position, product_id, dish_id, grams, pieces, from_dish_id";

/** PlanStore on PostgreSQL: parameterised SQL, no ORM (ADR-008). Plan and log rows share day_entries, told apart by kind (ADR-017/C-001). */
export class PostgresPlanStore implements PlanStore, DayCloser {
  constructor(
    private readonly pool: pg.Pool,
    private readonly newId: () => string,
  ) {}

  async read(day: string, kind: EntryKind = "plan"): Promise<PlanDay> {
    const closed = await this.pool.query<{ closed: boolean }>(
      "SELECT closed_at IS NOT NULL AS closed FROM days WHERE day = $1::date",
      [day],
    );
    const found = await this.pool.query<StoredEntry>(
      `SELECT ${COLUMNS} FROM day_entries WHERE kind = $2::text AND day = $1::date`,
      [day, kind],
    );
    return { closed: closed.rows[0]?.closed === true, entries: sortEntries(found.rows) };
  }

  /**
   * One transaction (ADR-020/C-002): insert the day row if missing, lock it, refuse when closed_at is set, insert one
   * day_ranges row per range from `resolveRanges`, then set closed_at. A throw rolls back everything, the day row too.
   */
  async closeDay(day: string, at: Date, resolveRanges: () => Promise<DayRange[]>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO days (day, created_at) VALUES ($1::date, $2::timestamptz) ON CONFLICT (day) DO NOTHING", [
        day,
        at,
      ]);
      const locked = await client.query<{ closed: boolean }>(
        "SELECT closed_at IS NOT NULL AS closed FROM days WHERE day = $1::date FOR UPDATE",
        [day],
      );
      if (locked.rows[0]?.closed !== false) throw new DayClosedError();
      for (const range of await resolveRanges()) {
        await client.query(
          "INSERT INTO day_ranges (day, nutrient, minimum, maximum) VALUES ($1::date, $2::text, $3::integer, $4::integer)",
          [day, range.nutrient, range.minimum, range.maximum],
        );
      }
      await client.query("UPDATE days SET closed_at = $2::timestamptz WHERE day = $1::date", [day, at]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async closedAt(day: string): Promise<Date | null> {
    const found = await this.pool.query<{ closed_at: Date | null }>("SELECT closed_at FROM days WHERE day = $1::date", [day]);
    return found.rows[0]?.closed_at ?? null;
  }

  async closedRanges(day: string): Promise<DayRange[]> {
    const found = await this.pool.query<DayRange>(
      `SELECT nutrient, minimum, maximum FROM day_ranges WHERE day = $1::date
       ORDER BY array_position(ARRAY['calories', 'protein', 'fat'], nutrient)`,
      [day],
    );
    return found.rows;
  }

  async closedDays(from: string, before: string): Promise<string[]> {
    const found = await this.pool.query<{ day: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day FROM days
       WHERE closed_at IS NOT NULL AND day >= $1::date AND day < $2::date ORDER BY day`,
      [from, before],
    );
    return found.rows.map((row) => row.day);
  }

  async firstRecordedDay(): Promise<string | undefined> {
    const found = await this.pool.query<{ first: string | null }>("SELECT to_char(MIN(day), 'YYYY-MM-DD') AS first FROM days");
    return found.rows[0]?.first ?? undefined;
  }

  /**
   * One transaction: insert the day row if missing, lock it, refuse when closed_at is set, then run the work
   * (ADR-019/C-001, C-002). A throw rolls back the day row too.
   */
  async mutate<T>(day: string, at: Date, work: (tx: PlanTx) => Promise<T>, kind: EntryKind = "plan"): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO days (day, created_at) VALUES ($1::date, $2::timestamptz) ON CONFLICT (day) DO NOTHING", [
        day,
        at,
      ]);
      const locked = await client.query<{ closed: boolean }>(
        "SELECT closed_at IS NOT NULL AS closed FROM days WHERE day = $1::date FOR UPDATE",
        [day],
      );
      if (locked.rows[0]?.closed !== false) throw new DayClosedError();
      const result = await work(this.tx(client, day, at, kind));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private tx(client: pg.PoolClient, day: string, at: Date, kind: EntryKind): PlanTx {
    return {
      add: async (entry: NewStoredEntry): Promise<StoredEntry> => {
        // The day row is locked, so max(position) + 1 cannot race (ADR-017/C-002).
        const saved = await client.query<StoredEntry>(
          `INSERT INTO day_entries (id, kind, day, meal, position, product_id, dish_id, grams, pieces, from_dish_id, created_at)
           SELECT $1::text, $10::text, $2::date, $3::text, COALESCE(MAX(position) + 1, 0),
                  $4::text, $5::text, $6::integer, $7::integer, $8::text, $9::timestamptz
           FROM day_entries WHERE kind = $10::text AND day = $2::date AND meal = $3::text
           RETURNING ${COLUMNS}`,
          [this.newId(), day, entry.meal, entry.product_id, entry.dish_id, entry.grams, entry.pieces, entry.from_dish_id, at, kind],
        );
        return saved.rows[0] as StoredEntry;
      },
      find: async (id: string): Promise<StoredEntry | undefined> => {
        const found = await client.query<StoredEntry>(
          `SELECT ${COLUMNS} FROM day_entries WHERE id = $1 AND kind = $3::text AND day = $2::date`,
          [id, day, kind],
        );
        return found.rows[0];
      },
      setAmount: async (id, amount): Promise<StoredEntry | undefined> => {
        const changed = await client.query<StoredEntry>(
          `UPDATE day_entries SET grams = $3::integer, pieces = $4::integer
           WHERE id = $1 AND kind = $5::text AND day = $2::date RETURNING ${COLUMNS}`,
          [id, day, amount.grams, amount.pieces, kind],
        );
        return changed.rows[0];
      },
      remove: async (id: string): Promise<boolean> => {
        const removed = await client.query("DELETE FROM day_entries WHERE id = $1 AND kind = $3::text AND day = $2::date", [
          id,
          day,
          kind,
        ]);
        return removed.rowCount === 1;
      },
      list: async (meal: Meal, other: EntryKind = kind): Promise<StoredEntry[]> => {
        const found = await client.query<StoredEntry>(
          `SELECT ${COLUMNS} FROM day_entries WHERE kind = $3::text AND day = $1::date AND meal = $2::text ORDER BY position`,
          [day, meal, other],
        );
        return found.rows;
      },
    };
  }
}
