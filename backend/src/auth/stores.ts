/** Storage seams for the Owner login (ADR-004/C-007, C-008). State lives in the database, never in process memory. */

export interface SessionStore {
  /** key is the SHA-256 of the cookie value. */
  create(key: string, expiresAt: number): Promise<void>;
  /** The expiry (ms since epoch) of the session row, if it exists. */
  findExpiry(key: string): Promise<number | undefined>;
  delete(key: string): Promise<void>;
}

export interface ThrottleState {
  failures: number;
  /** ms since epoch */
  windowStart: number;
}

export interface ThrottleStore {
  get(key: string): Promise<ThrottleState | undefined>;
  /** Counts one failure; a window older than windowMs restarts at 1. Returns the new state. */
  recordFailure(key: string, now: number, windowMs: number): Promise<ThrottleState>;
  clear(key: string): Promise<void>;
}

/** For unit tests only. */
export class InMemorySessionStore implements SessionStore {
  private readonly rows = new Map<string, number>();

  async create(key: string, expiresAt: number): Promise<void> {
    this.rows.set(key, expiresAt);
  }

  async findExpiry(key: string): Promise<number | undefined> {
    return this.rows.get(key);
  }

  async delete(key: string): Promise<void> {
    this.rows.delete(key);
  }

  size(): number {
    return this.rows.size;
  }
}

/** For unit tests only. */
export class InMemoryThrottleStore implements ThrottleStore {
  private readonly rows = new Map<string, ThrottleState>();

  async get(key: string): Promise<ThrottleState | undefined> {
    return this.rows.get(key);
  }

  async recordFailure(key: string, now: number, windowMs: number): Promise<ThrottleState> {
    const current = this.rows.get(key);
    const next: ThrottleState =
      current && current.windowStart > now - windowMs
        ? { failures: current.failures + 1, windowStart: current.windowStart }
        : { failures: 1, windowStart: now };
    this.rows.set(key, next);
    return next;
  }

  async clear(key: string): Promise<void> {
    this.rows.delete(key);
  }
}
