import type pg from "pg";
import type { StoredRange, TargetNutrient, TargetStore } from "./target-store.js";

const COLUMNS = "nutrient, minimum, maximum, to_char(effective_from, 'YYYY-MM-DD') AS effective_from";

/** TargetStore on PostgreSQL: parameterised SQL, no ORM (ADR-008). */
export class PostgresTargetStore implements TargetStore {
  constructor(private readonly pool: pg.Pool) {}

  async rangeInForce(nutrient: TargetNutrient, date: string): Promise<StoredRange | undefined> {
    const found = await this.pool.query<StoredRange>(
      `SELECT ${COLUMNS} FROM target_ranges WHERE nutrient = $1 AND effective_from <= $2::date ORDER BY effective_from DESC LIMIT 1`,
      [nutrient, date],
    );
    return found.rows[0];
  }

  /** One statement, so the insert or overwrite of the (nutrient, date) row is atomic (ADR-015/C-002). */
  async save(range: StoredRange): Promise<StoredRange> {
    const saved = await this.pool.query<StoredRange>(
      `INSERT INTO target_ranges (nutrient, effective_from, minimum, maximum) VALUES ($1, $2::date, $3, $4)
       ON CONFLICT (nutrient, effective_from) DO UPDATE SET minimum = EXCLUDED.minimum, maximum = EXCLUDED.maximum
       RETURNING ${COLUMNS}`,
      [range.nutrient, range.effective_from, range.minimum, range.maximum],
    );
    return saved.rows[0] as StoredRange;
  }

  async earliestEffectiveFrom(): Promise<string | undefined> {
    const found = await this.pool.query<{ earliest: string | null }>(
      "SELECT to_char(MIN(effective_from), 'YYYY-MM-DD') AS earliest FROM target_ranges",
    );
    return found.rows[0]?.earliest ?? undefined;
  }
}
