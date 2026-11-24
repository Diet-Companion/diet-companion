import type pg from "pg";
import {
  DishNotSelectableError,
  type DishLine,
  type DishRecord,
  type DishStore,
  type NewDish,
} from "./dish-store.js";
import type { ListState } from "./products.js";

/** The one SQL predicate for selectable: neither replaced nor soft-deleted (ADR-012/C-003). */
const SELECTABLE_SQL = "replaced_by IS NULL AND deleted_at IS NULL";

type DishRow = { id: string; name: string; replaced_by: string | null; deleted_at: Date | null };
type LineRow = { dish_id: string; position: number; product_id: string; grams: number | null; pieces: number | null };

const DISH_COLUMNS = "id, name, replaced_by, deleted_at";

/** numeric comes back from pg as text, so the amounts are cast to float8 on read. */
const LINE_COLUMNS = "dish_id, position, product_id, grams::float8 AS grams, pieces::float8 AS pieces";

/** DishStore on PostgreSQL: parameterised SQL, no ORM (ADR-008). */
export class PostgresDishStore implements DishStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly newId: () => string,
  ) {}

  /** Joins the lines of the given dish rows. The order of the rows is kept. */
  private async withLines(rows: DishRow[]): Promise<DishRecord[]> {
    if (rows.length === 0) return [];
    const found = await this.pool.query<LineRow>(
      `SELECT ${LINE_COLUMNS} FROM dish_lines WHERE dish_id = ANY($1::text[]) ORDER BY dish_id, position`,
      [rows.map((r) => r.id)],
    );
    const byDish = new Map<string, DishLine[]>();
    for (const l of found.rows) {
      const lines = byDish.get(l.dish_id) ?? [];
      lines.push({ position: l.position, product_id: l.product_id, grams: l.grams, pieces: l.pieces });
      byDish.set(l.dish_id, lines);
    }
    return rows.map((r) => ({
      dish: { id: r.id, name: r.name, lines: byDish.get(r.id) ?? [] },
      state: { replaced_by: r.replaced_by, deleted_at: r.deleted_at },
    }));
  }

  /** The dish and its lines are inserted in one transaction (ADR-012/C-004). Lines are never updated afterwards (C-002). */
  async add(dish: NewDish, at: Date): Promise<DishRecord> {
    const id = this.newId();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO dishes (id, name, created_at) VALUES ($1, $2, $3::timestamptz)", [id, dish.name, at]);
      for (const [position, line] of dish.lines.entries()) {
        await client.query(
          "INSERT INTO dish_lines (dish_id, position, product_id, grams, pieces) VALUES ($1, $2, $3, $4, $5)",
          [id, position, line.product_id, line.grams, line.pieces],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const saved = await this.get(id);
    if (!saved) throw new Error("insert returned no row");
    return saved;
  }

  async get(id: string): Promise<DishRecord | undefined> {
    const result = await this.pool.query<DishRow>(`SELECT ${DISH_COLUMNS} FROM dishes WHERE id = $1`, [id]);
    return (await this.withLines(result.rows))[0];
  }

  async listByState(state: ListState): Promise<DishRecord[]> {
    const where = state === "selectable" ? SELECTABLE_SQL : "deleted_at IS NOT NULL";
    const result = await this.pool.query<DishRow>(
      `SELECT ${DISH_COLUMNS} FROM dishes WHERE ${where} ORDER BY lower(name), id`,
    );
    return this.withLines(result.rows);
  }

  async softDelete(id: string, at: Date): Promise<DishRecord | undefined> {
    await this.pool.query(`UPDATE dishes SET deleted_at = $2::timestamptz WHERE id = $1 AND ${SELECTABLE_SQL}`, [id, at]);
    return this.settled(id);
  }

  async restore(id: string): Promise<DishRecord | undefined> {
    await this.pool.query(
      "UPDATE dishes SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL AND replaced_by IS NULL",
      [id],
    );
    return this.settled(id);
  }

  /** After a conditional update: the dish as it is now, or a refusal when it was replaced. */
  private async settled(id: string): Promise<DishRecord | undefined> {
    const record = await this.get(id);
    if (record && record.state.replaced_by !== null) throw new DishNotSelectableError("replaced by a newer version");
    return record;
  }
}
