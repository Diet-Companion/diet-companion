import { randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../migrate.js";
import { PostgresSessionStore, PostgresThrottleStore } from "./postgres-auth-store.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point at a test database");

const schema = `t_${randomUUID().replace(/-/g, "")}`;
const options = `-c search_path=${schema}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
let pool: pg.Pool;
let sessions: PostgresSessionStore;
let throttle: PostgresThrottleStore;
const NOW = Date.UTC(2026, 0, 1);

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  const client = new pg.Client({ connectionString: url, options });
  await client.connect();
  try {
    await runMigrations(client, join(import.meta.dirname, "..", "..", "migrations"));
  } finally {
    await client.end();
  }
  pool = new pg.Pool({ connectionString: url, options, max: 4 });
  sessions = new PostgresSessionStore(pool, () => NOW);
  throttle = new PostgresThrottleStore(pool);
});

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

describe("PostgresSessionStore", () => {
  // cites: IF-001@1.0.0#loginOwner
  it("stores a session row with its expiry", async () => {
    await sessions.create("key-a", NOW + 60_000);
    expect(await sessions.findExpiry("key-a")).toBe(NOW + 60_000);
  });

  // cites: IF-001@1.0.0#logout
  it("deletes the session row", async () => {
    await sessions.create("key-b", NOW + 60_000);
    await sessions.delete("key-b");
    expect(await sessions.findExpiry("key-b")).toBeUndefined();
  });

  // cites: IF-001@1.0.0#loginOwner
  it("removes already expired rows when a session is created", async () => {
    await sessions.create("key-old", NOW - 1);
    await sessions.create("key-c", NOW + 60_000);
    expect(await sessions.findExpiry("key-old")).toBeUndefined();
  });
});

describe("PostgresThrottleStore", () => {
  // cites: IF-001@1.0.0#loginOwner
  it("counts failures within a window", async () => {
    expect((await throttle.recordFailure("k1", NOW, 10_000)).failures).toBe(1);
    const second = await throttle.recordFailure("k1", NOW + 1_000, 10_000);
    expect(second).toEqual({ failures: 2, windowStart: NOW });
    expect(await throttle.get("k1")).toEqual(second);
  });

  // cites: IF-001@1.0.0#loginOwner
  it("restarts the count when the window has passed", async () => {
    await throttle.recordFailure("k2", NOW, 10_000);
    await throttle.recordFailure("k2", NOW + 1_000, 10_000);
    const restarted = await throttle.recordFailure("k2", NOW + 20_000, 10_000);
    expect(restarted).toEqual({ failures: 1, windowStart: NOW + 20_000 });
  });

  // cites: IF-001@1.0.0#loginOwner
  it("loses no failure when attempts run concurrently", async () => {
    await Promise.all([1, 2, 3, 4].map(() => throttle.recordFailure("k3", NOW, 10_000)));
    expect((await throttle.get("k3"))?.failures).toBe(4);
  });

  // cites: IF-001@1.0.0#loginOwner
  it("clears the state", async () => {
    await throttle.recordFailure("k4", NOW, 10_000);
    await throttle.clear("k4");
    expect(await throttle.get("k4")).toBeUndefined();
  });
});
