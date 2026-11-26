import type pg from "pg";
import {
  DayClosedError,
  sortEntries,
  type NewStoredEntry,
  type PlanDay,
  type PlanStore,
  type PlanTx,
  type StoredEntry,
} from "./plan-store.js";

const COLUMNS = "id, meal, position, product_id, dish_id, grams, pieces, from_dish_id";

/** PlanStore on PostgreSQL: parameterised SQL, no ORM (ADR-008). Plan rows are the rows with kind 'plan' (ADR-017/C-001). */
export class PostgresPlanStore implements PlanStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly newId: () => string,
  ) {}

  async read(day: string): Promise<PlanDay> {
    const closed = await this.pool.query<{ closed: boolean }>(
      "SELECT closed_at IS NOT NULL AS closed FROM days WHERE day = $1::date",
      [day],
    );
    const found = await this.pool.query<StoredEntry>(
      `SELECT ${COLUMNS} FROM day_entries WHERE kind = 'plan' AND day = $1::date`,
      [day],
    );
    return { closed: closed.rows[0]?.closed === true, entries: sortEntries(found.rows) };
  }

  /**
   * One transaction: insert the day row if missing, lock it, refuse when closed_at is set, then run the work
   * (ADR-019/C-001, C-002). A throw rolls back the day row too.
   */
  async mutate<T>(day: string, at: Date, work: (tx: PlanTx) => Promise<T>): Promise<T> {
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
      const result = await work(this.tx(client, day, at));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private tx(client: pg.PoolClient, day: string, at: Date): PlanTx {
    return {
      add: async (entry: NewStoredEntry): Promise<StoredEntry> => {
        // The day row is locked, so max(position) + 1 cannot race (ADR-017/C-002).
        const saved = await client.query<StoredEntry>(
          `INSERT INTO day_entries (id, kind, day, meal, position, product_id, dish_id, grams, pieces, from_dish_id, created_at)
           SELECT $1::text, 'plan'::text, $2::date, $3::text, COALESCE(MAX(position) + 1, 0),
                  $4::text, $5::text, $6::integer, $7::integer, $8::text, $9::timestamptz
           FROM day_entries WHERE kind = 'plan' AND day = $2::date AND meal = $3::text
           RETURNING ${COLUMNS}`,
          [this.newId(), day, entry.meal, entry.product_id, entry.dish_id, entry.grams, entry.pieces, entry.from_dish_id, at],
        );
        return saved.rows[0] as StoredEntry;
      },
      find: async (id: string): Promise<StoredEntry | undefined> => {
        const found = await client.query<StoredEntry>(
          `SELECT ${COLUMNS} FROM day_entries WHERE id = $1 AND kind = 'plan' AND day = $2::date`,
          [id, day],
        );
        return found.rows[0];
      },
      setAmount: async (id, amount): Promise<StoredEntry | undefined> => {
        const changed = await client.query<StoredEntry>(
          `UPDATE day_entries SET grams = $3::integer, pieces = $4::integer
           WHERE id = $1 AND kind = 'plan' AND day = $2::date RETURNING ${COLUMNS}`,
          [id, day, amount.grams, amount.pieces],
        );
        return changed.rows[0];
      },
      remove: async (id: string): Promise<boolean> => {
        const removed = await client.query("DELETE FROM day_entries WHERE id = $1 AND kind = 'plan' AND day = $2::date", [
          id,
          day,
        ]);
        return removed.rowCount === 1;
      },
    };
  }
}
