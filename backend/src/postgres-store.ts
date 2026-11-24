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
  carbohydrate: number | null;
  sugars: number | null;
  fibre: number | null;
  salt: number | null;
  portion_size_g: number | null;
  portion_calories: number | null;
  piece_weight_g: number | null;
};

/** Migration 001 columns, then the optional ones added by migration 003. */
const COLUMNS =
  "id, name, shop, calories, protein, fat, brand, source, carbohydrate, sugars, fibre, salt, portion_size_g, portion_calories, piece_weight_g";

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
        `INSERT INTO products (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING ${COLUMNS}`,
        [
          this.newId(),
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
