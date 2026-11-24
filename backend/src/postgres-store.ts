import type pg from "pg";
import {
  DuplicateProductError,
  type NewProduct,
  type Product,
  type ProductSource,
  type ProductStore,
} from "./products.js";

/** The unique index that enforces R-003 (migration 001). */
export const NAME_SHOP_INDEX = "products_name_shop_key";

/** Same expression as the index, so a lookup and the index agree (R-003). */
const norm = (param: string): string => `lower(btrim(regexp_replace(${param}, '\\s+', ' ', 'g')))`;

type ProductRow = {
  id: string;
  name: string;
  shop: string;
  calories: number;
  protein: number;
  fat: number;
  brand: string | null;
  source: ProductSource;
};

const COLUMNS = "id, name, shop, calories, protein, fat, brand, source";

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
  return product;
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
      `SELECT ${COLUMNS} FROM products WHERE ${norm("name")} = ${norm("$1::text")} AND ${norm("shop")} = ${norm("$2::text")} LIMIT 1`,
      [name, shop],
    );
    const row = result.rows[0];
    return row ? toProduct(row) : undefined;
  }

  async add(product: NewProduct): Promise<Product> {
    try {
      const result = await this.pool.query<ProductRow>(
        `INSERT INTO products (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
        [
          this.newId(),
          product.name,
          product.shop,
          product.calories,
          product.protein,
          product.fat,
          product.brand ?? null,
          product.source,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("insert returned no row");
      return toProduct(row);
    } catch (error) {
      if (isNameShopViolation(error)) throw new DuplicateProductError("duplicate name and shop");
      throw error;
    }
  }
}
