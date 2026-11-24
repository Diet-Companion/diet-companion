import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

/** Migration files are named NNN_<what>.sql and applied in name order, once each (ADR-008/C-001). */
const MIGRATION_FILE = /^\d{3,}_[a-z0-9_]+\.sql$/;

/** Any fixed number: serialises runners so two instances never migrate at once. */
const LOCK_KEY = 80008;

/** Applies the pending migrations in dir, each in its own transaction. Returns the names applied. */
export async function runMigrations(client: pg.Client, dir: string): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => MIGRATION_FILE.test(f)).sort();
  const applied: string[] = [];
  await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const seen = new Set(done.rows.map((r) => r.name));
    for (const file of files) {
      if (seen.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      applied.push(file);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
  }
  return applied;
}

/** The backend script `migrate`: reads DATABASE_URL, applies backend/migrations. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const applied = await runMigrations(client, join(import.meta.dirname, "..", "migrations"));
    console.log(applied.length === 0 ? "No pending migrations." : `Applied: ${applied.join(", ")}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
