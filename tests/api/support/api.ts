// API test support (S-QA-004 API layer, S-TESTAB-002/-004/-008). Every test file gets its own PostgreSQL schema,
// migrated from scratch, and the real backend built in-process with the real stores and the real Owner login.
// External services are faked at their seams: the label provider (CMP-003) and the clock.
// Needs DATABASE_URL, a throwaway test database (CI's integration job provides one).
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { LabelProvider, LabelValues } from "@diet-companion/label-reader";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import pg from "pg";
import { buildApp } from "../../../backend/src/app.js";
import { hashPassword } from "../../../backend/src/auth/password.js";
import { PostgresSessionStore, PostgresThrottleStore } from "../../../backend/src/auth/postgres-auth-store.js";
import { runMigrations } from "../../../backend/src/migrate.js";
import { PostgresDishStore } from "../../../backend/src/postgres-dish-store.js";
import { PostgresProductStore } from "../../../backend/src/postgres-store.js";

/** Cheap scrypt parameters: the test Owner password is synthetic and lives for one test file. */
const TEST_SCRYPT = { N: 1024, r: 8, p: 1 };

export interface ApiOptions {
  /** What the fake label provider reads from any photo, or an error it throws. Default: no provider. */
  label?: LabelValues | Error;
  /** The clock seam. Default: the system clock. */
  now?: () => Date;
}

export interface Api {
  app: FastifyInstance;
  /** The synthetic Owner password of this file's app. */
  password: string;
  /** Logs in as the Owner; later requests carry the session cookie. */
  login(): Promise<void>;
  /** Forgets the session cookie, so requests are anonymous. */
  logout(): void;
  /** Sends a request with the session cookie, if logged in. A body object is sent as JSON. */
  request(method: InjectOptions["method"], url: string, body?: unknown): Promise<LightMyRequestResponse>;
  /** Sends a label photo to POST /products/label-photo as multipart. */
  labelPhoto(bytes: Uint8Array): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export async function startApi(options: ApiOptions = {}): Promise<Api> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must point at a throwaway test database");
  const schema = `api_${randomUUID().replace(/-/g, "")}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pgOptions = `-c search_path=${schema}`;
  const client = new pg.Client({ connectionString: url, options: pgOptions });
  await client.connect();
  try {
    await runMigrations(client, join(import.meta.dirname, "..", "..", "..", "backend", "migrations"));
  } finally {
    await client.end();
  }
  const pool = new pg.Pool({ connectionString: url, options: pgOptions, max: 4 });

  const password = randomBytes(12).toString("hex");
  const labelProvider: LabelProvider | undefined =
    options.label === undefined
      ? undefined
      : {
          readLabel: async () => {
            if (options.label instanceof Error) throw options.label;
            return { ...(options.label as LabelValues) };
          },
        };

  const app = buildApp({
    store: new PostgresProductStore(pool, randomUUID),
    dishStore: new PostgresDishStore(pool, randomUUID),
    auth: {
      sessions: new PostgresSessionStore(pool),
      throttle: new PostgresThrottleStore(pool),
      passwordHash: await hashPassword(password, TEST_SCRYPT),
    },
    labelProvider,
    clock: options.now,
  });
  await app.ready();

  let cookie: string | undefined;
  const send = (opts: InjectOptions): Promise<LightMyRequestResponse> =>
    app.inject({ ...opts, headers: { ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) } });

  return {
    app,
    password,
    async login() {
      const res = await app.inject({ method: "POST", url: "/auth/login", payload: { password } });
      if (res.statusCode !== 204) throw new Error(`login failed: ${res.statusCode}`);
      const set = res.headers["set-cookie"];
      const first = Array.isArray(set) ? set[0] : set;
      cookie = first?.split(";")[0];
    },
    logout() {
      cookie = undefined;
    },
    request(method, url, body) {
      return send(body === undefined ? { method, url } : { method, url, payload: body as InjectOptions["payload"] });
    },
    labelPhoto(bytes) {
      const boundary = `----api-test-${randomUUID()}`;
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="label.png"\r\n` +
          "Content-Type: image/png\r\n\r\n",
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      return send({
        method: "POST",
        url: "/products/label-photo",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([head, Buffer.from(bytes), tail]),
      });
    },
    async close() {
      await app.close();
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    },
  };
}

/** A product body with the required values; override what the test is about (test data, S-TESTAB-004). */
export function newProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Product ${randomUUID().slice(0, 8)}`,
    shop: "Shop A",
    calories: 100,
    protein: 10,
    fat: 5,
    source: "manual",
    ...overrides,
  };
}

/** The first bytes of a PNG: enough for the backend's type check; the fake provider ignores the content. */
export const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
