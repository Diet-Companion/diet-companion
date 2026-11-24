import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LabelProvider } from "@diet-companion/label-reader";

/** Largest accepted label photo (a choice of this slice; no source states a limit). */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

export type ProductSource = "label" | "lookup" | "manual";
const SOURCES: readonly string[] = ["label", "lookup", "manual"];

/** The five values R-002 requires, in the order IF-001 lists them. */
const REQUIRED = ["name", "shop", "calories", "protein", "fat"] as const;
export type RequiredField = (typeof REQUIRED)[number];

/** Optional numeric values of IF-001@1.1.0, all per 100 g except the portion and piece ones. */
const OPTIONAL_NUMBERS = [
  "carbohydrate",
  "sugars",
  "fibre",
  "salt",
  "portion_size",
  "portion_calories",
  "piece_weight",
] as const;
export type OptionalNumberField = (typeof OPTIONAL_NUMBERS)[number];

/** Every numeric field createProduct checks for a negative value (IF-001@1.1.0 product.value_invalid). */
const NUMERIC_FIELDS = ["calories", "protein", "fat", ...OPTIONAL_NUMBERS] as const;

/** For these a 0 means empty and is stored as NULL (IF-001@1.1.0); nutrient fields keep a real 0. */
const ZERO_IS_EMPTY: readonly string[] = ["portion_size", "portion_calories", "piece_weight"];

/** Values recognised or supplied so far, per 100 g. */
export interface Recognised {
  name?: string;
  shop?: string;
  calories?: number;
  protein?: number;
  fat?: number;
  brand?: string;
  carbohydrate?: number;
  sugars?: number;
  fibre?: number;
  salt?: number;
  portion_size?: number;
  portion_calories?: number;
  piece_weight?: number;
}

export interface NewProduct {
  name: string;
  shop: string;
  calories: number;
  protein: number;
  fat: number;
  brand?: string;
  source: ProductSource;
  carbohydrate?: number;
  sugars?: number;
  fibre?: number;
  salt?: number;
  portion_size?: number;
  portion_calories?: number;
  piece_weight?: number;
}

export interface Product extends NewProduct {
  id: string;
}

/** A product as IF-001@1.1.0 returns it: the stored values plus the two derived read-only ones. */
export interface ProductResponse extends Product {
  /** mg per 100 g: salt x 400 rounded to 2 decimals, 0 when salt is empty (R-001). Never stored. */
  sodium: number;
  /** True exactly when a piece weight is stored (R-003). Never stored. */
  counted_by_piece: boolean;
}

/** Adds the values computed on read (R-001, R-003). Sodium is rounded to hide float noise (1.15 g gives 460). */
export function toProductResponse(product: Product): ProductResponse {
  return {
    ...product,
    sodium: Math.round((product.salt ?? 0) * 400 * 100) / 100,
    counted_by_piece: product.piece_weight !== undefined,
  };
}

export class DuplicateProductError extends Error {}

/** Storage seam. Postgres comes later; the real store enforces R-003 by a unique index too. */
export interface ProductStore {
  /** A selectable product with the same name and shop (R-003 comparison), if any. */
  findSelectable(name: string, shop: string): Promise<Product | undefined>;
  /** Throws DuplicateProductError when R-003 would be broken. */
  add(product: NewProduct): Promise<Product>;
}

/** R-003: compare ignoring letter case and leading, trailing or repeated spaces. */
export function normaliseKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export class InMemoryProductStore implements ProductStore {
  private readonly items: Product[] = [];

  constructor(private readonly newId: () => string) {}

  async findSelectable(name: string, shop: string): Promise<Product | undefined> {
    const n = normaliseKey(name);
    const s = normaliseKey(shop);
    return this.items.find((p) => normaliseKey(p.name) === n && normaliseKey(p.shop) === s);
  }

  async add(product: NewProduct): Promise<Product> {
    if (await this.findSelectable(product.name, product.shop)) {
      throw new DuplicateProductError("duplicate name and shop");
    }
    const saved: Product = { ...product, id: this.newId() };
    this.items.push(saved);
    return saved;
  }

  list(): readonly Product[] {
    return this.items;
  }
}

export interface ProductRouteDeps {
  store: ProductStore;
  /** The recognition seam (CMP-003). Absent: recognition is unavailable. */
  labelProvider?: LabelProvider;
  /** The owner check hook. Absent: every request is refused (fail closed, ADR-004/C-005). */
  isOwner?: (request: FastifyRequest) => boolean | Promise<boolean>;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Keeps only valid values; a blank text or a negative or non-numeric nutrient is not a value (R-002). */
function toRecognised(input: Record<string, unknown>): Recognised {
  const out: Recognised = {};
  const name = cleanText(input.name);
  const shop = cleanText(input.shop);
  const brand = cleanText(input.brand);
  const calories = cleanNumber(input.calories);
  const protein = cleanNumber(input.protein);
  const fat = cleanNumber(input.fat);
  if (name !== undefined) out.name = name;
  if (shop !== undefined) out.shop = shop;
  if (calories !== undefined) out.calories = calories;
  if (protein !== undefined) out.protein = protein;
  if (fat !== undefined) out.fat = fat;
  if (brand !== undefined) out.brand = brand;
  for (const key of OPTIONAL_NUMBERS) {
    const value = cleanNumber(input[key]);
    if (value === undefined) continue;
    if (value === 0 && ZERO_IS_EMPTY.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/** The numeric fields whose supplied value is negative, in IF-001 order (product.value_invalid). */
function negativeFields(input: Record<string, unknown>): string[] {
  return NUMERIC_FIELDS.filter((field) => {
    const value = input[field];
    return typeof value === "number" && value < 0;
  });
}

function missingOf(values: Recognised): RequiredField[] {
  return REQUIRED.filter((field) => values[field] === undefined);
}

function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): FastifyReply {
  const runId = request.headers["x-run-id"];
  return reply.code(status).send({
    code,
    message,
    ...(typeof runId === "string" ? { run_id: runId } : {}),
    ...extra,
  });
}

async function requireOwner(deps: ProductRouteDeps, request: FastifyRequest): Promise<boolean> {
  if (!deps.isOwner) return false;
  try {
    return await deps.isOwner(request);
  } catch {
    return false;
  }
}

function refuseUnauthorised(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendError(request, reply, 401, "auth.required", "No valid Owner session.");
}

/**
 * Shared tail of both operations: R-003 first (A-001), then R-002, then save.
 * source is undefined only when a createProduct body carries no valid source.
 */
async function validateAndSave(
  deps: ProductRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  values: Recognised,
  source: ProductSource | undefined,
): Promise<FastifyReply> {
  const duplicate = (): FastifyReply =>
    sendError(
      request,
      reply,
      409,
      "product.duplicate_name_shop",
      "A product with that name and shop already exists.",
    );

  if (
    values.name !== undefined &&
    values.shop !== undefined &&
    (await deps.store.findSelectable(values.name, values.shop))
  ) {
    return duplicate();
  }

  const { name, shop, calories, protein, fat } = values;
  if (
    name === undefined ||
    shop === undefined ||
    calories === undefined ||
    protein === undefined ||
    fat === undefined ||
    source === undefined
  ) {
    return sendError(
      request,
      reply,
      422,
      "product.values_missing",
      "Required values are missing.",
      { missing: missingOf(values), recognised: values },
    );
  }

  const product: NewProduct = { name, shop, calories, protein, fat, source };
  if (values.brand !== undefined) product.brand = values.brand;
  for (const key of OPTIONAL_NUMBERS) {
    const value = values[key];
    if (value !== undefined) product[key] = value;
  }
  try {
    return reply.code(201).send(toProductResponse(await deps.store.add(product)));
  } catch (error) {
    if (error instanceof DuplicateProductError) return duplicate();
    throw error;
  }
}

/** The photo, held in memory for this request only. Undefined when it cannot be processed. */
async function readPhoto(request: FastifyRequest): Promise<Uint8Array | undefined> {
  try {
    const part = await request.file();
    if (!part || part.fieldname !== "photo") return undefined;
    const photo = await part.toBuffer();
    return photo.length > 0 ? photo : undefined;
  } catch {
    return undefined;
  }
}

export function registerProductRoutes(app: FastifyInstance, deps: ProductRouteDeps): void {
  // IF-001@1.1.0 addProductFromLabelPhoto
  app.post("/products/label-photo", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return refuseUnauthorised(request, reply);

    const photo = await readPhoto(request);
    if (!photo) {
      return sendError(request, reply, 400, "photo.unreadable", "The photo cannot be processed.");
    }

    let recognised: Recognised;
    try {
      if (!deps.labelProvider) throw new Error("no label provider");
      const runId = request.headers["x-run-id"];
      const read = await deps.labelProvider.readLabel(photo, typeof runId === "string" ? runId : undefined);
      recognised = toRecognised({ ...read });
    } catch {
      return sendError(
        request,
        reply,
        502,
        "recognition.unavailable",
        "The recognition provider failed.",
      );
    }
    return validateAndSave(deps, request, reply, recognised, "label");
  });

  // IF-001@1.1.0 createProduct
  app.post("/products", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return refuseUnauthorised(request, reply);

    const body: Record<string, unknown> =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    // A negative value is refused before R-003 and R-002, and nothing is saved.
    const invalid = negativeFields(body);
    if (invalid.length > 0) {
      return sendError(request, reply, 400, "product.value_invalid", "A numeric value is negative.", { invalid });
    }
    const source = SOURCES.includes(body.source as string) ? (body.source as ProductSource) : undefined;
    return validateAndSave(deps, request, reply, toRecognised(body), source);
  });
}
