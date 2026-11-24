import type pg from "pg";
import {
  DuplicateProductError,
  NotSelectableError,
  isSameValues,
  isSelectable,
  mergeProduct,
  touchesNutrients,
  type EditOutcome,
  type ListState,
  type NewProduct,
  type Product,
  type ProductChanges,
  type ProductRecord,
  type ProductSource,
  type ProductStore,
} from "./products.js";

/** The unique index that enforces R-003 (migration 001, rebuilt over selectable rows by migration 004). */
export const NAME_SHOP_INDEX = "products_name_shop_key";

/** Same expression as the index, so a lookup and the index agree (R-003). */
const norm = (param: string): string => `lower(btrim(regexp_replace(${param}, '\\s+', ' ', 'g')))`;

/** The one SQL predicate for selectable: neither replaced nor soft-deleted (ADR-010/C-003). */
const SELECTABLE_SQL = "replaced_by IS NULL AND deleted_at IS NULL";

type ProductRow = {
  id: string;
  name: string;
  shop: string;
  calories: number;
  protein: number;
  fat: number;
  brand: string | null;
  source: ProductSource;
  carbohydrate: number | null;
  sugars: number | null;
  fibre: number | null;
  salt: number | null;
  portion_size_g: number | null;
  portion_calories: number | null;
  piece_weight_g: number | null;
};

type RecordRow = ProductRow & { replaced_by: string | null; deleted_at: Date | null };

/** Migration 001 columns, then the optional ones added by migration 003. */
const COLUMNS =
  "id, name, shop, calories, protein, fat, brand, source, carbohydrate, sugars, fibre, salt, portion_size_g, portion_calories, piece_weight_g";

/** The product columns plus the state columns added by migration 004. */
const RECORD_COLUMNS = `${COLUMNS}, replaced_by, deleted_at`;

const INSERT_SQL = `INSERT INTO products (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING ${COLUMNS}`;

/** Parameters of INSERT_SQL. The nutrient columns are written only here (ADR-010/C-002). */
function insertValues(id: string, product: NewProduct): unknown[] {
  return [
    id,
    product.name,
    product.shop,
    product.calories,
    product.protein,
    product.fat,
    product.brand ?? null,
    product.source,
    product.carbohydrate ?? null,
    product.sugars ?? null,
    product.fibre ?? null,
    product.salt ?? null,
    product.portion_size ?? null,
    product.portion_calories ?? null,
    product.piece_weight ?? null,
  ];
}

function toProduct(row: ProductRow): Product {
  const product: Product = {
    id: row.id,
    name: row.name,
    shop: row.shop,
    calories: row.calories,
    protein: row.protein,
    fat: row.fat,
    source: row.source,
  };
  if (row.brand !== null) product.brand = row.brand;
  if (row.carbohydrate !== null) product.carbohydrate = row.carbohydrate;
  if (row.sugars !== null) product.sugars = row.sugars;
  if (row.fibre !== null) product.fibre = row.fibre;
  if (row.salt !== null) product.salt = row.salt;
  if (row.portion_size_g !== null) product.portion_size = row.portion_size_g;
  if (row.portion_calories !== null) product.portion_calories = row.portion_calories;
  if (row.piece_weight_g !== null) product.piece_weight = row.piece_weight_g;
  return product;
}

function toRecord(row: RecordRow): ProductRecord {
  return { product: toProduct(row), state: { replaced_by: row.replaced_by, deleted_at: row.deleted_at } };
}

function isNameShopViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; constraint?: unknown };
  return e.code === "23505" && e.constraint === NAME_SHOP_INDEX;
}

/** ProductStore on PostgreSQL: parameterised SQL, no ORM (ADR-008). */
export class PostgresProductStore implements ProductStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly newId: () => string,
  ) {}

  async findSelectable(name: string, shop: string): Promise<Product | undefined> {
    const result = await this.pool.query<ProductRow>(
      `SELECT ${COLUMNS} FROM products WHERE ${SELECTABLE_SQL} AND ${norm("name")} = ${norm("$1::text")} AND ${norm("shop")} = ${norm("$2::text")} LIMIT 1`,
      [name, shop],
    );
    const row = result.rows[0];
    return row ? toProduct(row) : undefined;
  }

  async add(product: NewProduct): Promise<Product> {
    try {
      const result = await this.pool.query<ProductRow>(INSERT_SQL, insertValues(this.newId(), product));
      const row = result.rows[0];
      if (!row) throw new Error("insert returned no row");
      return toProduct(row);
    } catch (error) {
      if (isNameShopViolation(error)) throw new DuplicateProductError("duplicate name and shop");
      throw error;
    }
  }

  async get(id: string): Promise<ProductRecord | undefined> {
    const result = await this.pool.query<RecordRow>(`SELECT ${RECORD_COLUMNS} FROM products WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? toRecord(row) : undefined;
  }

  async listByState(state: ListState): Promise<ProductRecord[]> {
    const where = state === "selectable" ? SELECTABLE_SQL : "deleted_at IS NOT NULL";
    const result = await this.pool.query<RecordRow>(
      `SELECT ${RECORD_COLUMNS} FROM products WHERE ${where} ORDER BY lower(name), lower(shop), id`,
    );
    return result.rows.map(toRecord);
  }

  async softDelete(id: string, at: Date): Promise<ProductRecord | undefined> {
    const result = await this.pool.query<RecordRow>(
      `UPDATE products SET deleted_at = $2::timestamptz WHERE id = $1 AND ${SELECTABLE_SQL} RETURNING ${RECORD_COLUMNS}`,
      [id, at],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : this.unchanged(id);
  }

  async restore(id: string): Promise<ProductRecord | undefined> {
    try {
      const result = await this.pool.query<RecordRow>(
        `UPDATE products SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL AND replaced_by IS NULL RETURNING ${RECORD_COLUMNS}`,
        [id],
      );
      const row = result.rows[0];
      return row ? toRecord(row) : await this.unchanged(id);
    } catch (error) {
      if (isNameShopViolation(error)) throw new DuplicateProductError("duplicate name and shop");
      throw error;
    }
  }

  /**
   * One transaction (ADR-010/C-004). The row is locked first, so a concurrent edit waits and then finds it
   * replaced. A nutrient change updates the old row (replaced_by, conditional on selectable) and then inserts
   * the new row, so the partial unique index never sees the pair as selectable together (AC-013). Any other
   * change updates the editable columns in place (R-005).
   */
  async edit(id: string, changes: ProductChanges): Promise<EditOutcome | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<RecordRow>(`SELECT ${RECORD_COLUMNS} FROM products WHERE id = $1 FOR UPDATE`, [id]);
      const row = found.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const record = toRecord(row);
      if (!isSelectable(record.state)) throw new NotSelectableError("not selectable");
      const merged = mergeProduct(record.product, changes);
      if (isSameValues(record.product, merged)) {
        await client.query("ROLLBACK");
        return { product: record.product, versioned: false, replaced_id: null };
      }
      let outcome: EditOutcome;
      if (touchesNutrients(record.product, merged)) {
        const newId = this.newId();
        const replaced = await client.query(`UPDATE products SET replaced_by = $2 WHERE id = $1 AND ${SELECTABLE_SQL}`, [id, newId]);
        if (replaced.rowCount !== 1) throw new NotSelectableError("not selectable");
        const inserted = await client.query<ProductRow>(INSERT_SQL, insertValues(newId, merged));
        const created = inserted.rows[0];
        if (!created) throw new Error("insert returned no row");
        outcome = { product: toProduct(created), versioned: true, replaced_id: id };
      } else {
        const updated = await client.query<ProductRow>(
          `UPDATE products SET name = $2, shop = $3, brand = $4, portion_size_g = $5, portion_calories = $6 WHERE id = $1 AND ${SELECTABLE_SQL} RETURNING ${COLUMNS}`,
          [id, merged.name, merged.shop, merged.brand ?? null, merged.portion_size ?? null, merged.portion_calories ?? null],
        );
        const changed = updated.rows[0];
        if (!changed) throw new NotSelectableError("not selectable");
        outcome = { product: toProduct(changed), versioned: false, replaced_id: null };
      }
      await client.query("COMMIT");
      return outcome;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (isNameShopViolation(error)) throw new DuplicateProductError("duplicate name and shop");
      throw error;
    } finally {
      client.release();
    }
  }

  /** The conditional update matched no row: unknown id, replaced (refused), or already in the wanted state. */
  private async unchanged(id: string): Promise<ProductRecord | undefined> {
    const record = await this.get(id);
    if (record && record.state.replaced_by !== null) throw new NotSelectableError("replaced by a newer version");
    return record;
  }
}
