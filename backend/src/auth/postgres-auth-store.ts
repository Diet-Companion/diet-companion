import type pg from "pg";
import type { SessionStore, ThrottleState, ThrottleStore } from "./stores.js";

/** SessionStore on PostgreSQL (migration 002): parameterised SQL, no ORM (ADR-008). */
export class PostgresSessionStore implements SessionStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly now: () => number = Date.now,
  ) {}

  async create(key: string, expiresAt: number): Promise<void> {
    // Housekeeping: drop rows that already expired.
    await this.pool.query("DELETE FROM owner_sessions WHERE expires_at <= $1::timestamptz", [new Date(this.now())]);
    await this.pool.query("INSERT INTO owner_sessions (id, expires_at) VALUES ($1, $2::timestamptz)", [
      key,
      new Date(expiresAt),
    ]);
  }

  async findExpiry(key: string): Promise<number | undefined> {
    const result = await this.pool.query<{ expires_at: Date }>(
      "SELECT expires_at FROM owner_sessions WHERE id = $1",
      [key],
    );
    const row = result.rows[0];
    return row ? row.expires_at.getTime() : undefined;
  }

  async delete(key: string): Promise<void> {
    await this.pool.query("DELETE FROM owner_sessions WHERE id = $1", [key]);
  }
}

/** ThrottleStore on PostgreSQL; the upsert is atomic, so instances never lose a failure. */
export class PostgresThrottleStore implements ThrottleStore {
  constructor(private readonly pool: pg.Pool) {}

  async get(key: string): Promise<ThrottleState | undefined> {
    const result = await this.pool.query<{ failures: number; window_start: Date }>(
      "SELECT failures, window_start FROM login_throttle WHERE key = $1",
      [key],
    );
    const row = result.rows[0];
    return row ? { failures: row.failures, windowStart: row.window_start.getTime() } : undefined;
  }

  async recordFailure(key: string, now: number, windowMs: number): Promise<ThrottleState> {
    const result = await this.pool.query<{ failures: number; window_start: Date }>(
      `INSERT INTO login_throttle (key, failures, window_start) VALUES ($1, 1, $2::timestamptz)
       ON CONFLICT (key) DO UPDATE SET
         failures = CASE WHEN login_throttle.window_start <= $3::timestamptz THEN 1 ELSE login_throttle.failures + 1 END,
         window_start = CASE WHEN login_throttle.window_start <= $3::timestamptz THEN $2::timestamptz ELSE login_throttle.window_start END
       RETURNING failures, window_start`,
      [key, new Date(now), new Date(now - windowMs)],
    );
    const row = result.rows[0];
    if (!row) throw new Error("upsert returned no row");
    return { failures: row.failures, windowStart: row.window_start.getTime() };
  }

  async clear(key: string): Promise<void> {
    await this.pool.query("DELETE FROM login_throttle WHERE key = $1", [key]);
  }
}
