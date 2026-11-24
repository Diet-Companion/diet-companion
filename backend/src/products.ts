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

/** Version and soft-delete state of a product row (ADR-010). Selectable when both are null. */
export interface ProductState {
  replaced_by: string | null;
  deleted_at: Date | null;
}

/** A product with its state: what getProduct and listProducts read (ADR-010/C-003). */
export interface ProductRecord {
  product: Product;
  state: ProductState;
}

const SELECTABLE_STATE: ProductState = { replaced_by: null, deleted_at: null };

/** The one predicate that decides selectable (ADR-010/C-003): neither replaced nor soft-deleted (R-004, R-006). */
export function isSelectable(state: ProductState): boolean {
  return state.replaced_by === null && state.deleted_at === null;
}

/** A product as IF-001@1.2.0 returns it: the stored values plus the derived read-only ones. */
export interface ProductResponse extends Product {
  /** mg per 100 g: salt x 400 rounded to 2 decimals, 0 when salt is empty (R-001). Never stored. */
  sodium: number;
  /** True exactly when a piece weight is stored (R-003). Never stored. */
  counted_by_piece: boolean;
  /** Id of the newer version that replaced this product, or null (R-004). */
  replaced_by: string | null;
  /** True when the product is soft-deleted (R-006). */
  deleted: boolean;
  /** True when neither replaced nor soft-deleted. Derived, never stored. */
  selectable: boolean;
}

/** Adds the values computed on read (R-001, R-003). Sodium is rounded to hide float noise (1.15 g gives 460). */
export function toProductResponse(product: Product, state: ProductState = SELECTABLE_STATE): ProductResponse {
  return {
    ...product,
    sodium: Math.round((product.salt ?? 0) * 400 * 100) / 100,
    counted_by_piece: product.piece_weight !== undefined,
    replaced_by: state.replaced_by,
    deleted: state.deleted_at !== null,
    selectable: isSelectable(state),
  };
}

export class DuplicateProductError extends Error {}

/** The product was replaced by a newer version (IF-001 product.not_selectable). */
export class NotSelectableError extends Error {}

/** Which products listProducts returns (IF-001@1.2.0 state parameter). */
export type ListState = "selectable" | "deleted";

/** Storage seam. Postgres comes later; the real store enforces R-003 by a unique index too. */
export interface ProductStore {
  /** A selectable product with the same name and shop (R-003 comparison), if any. */
  findSelectable(name: string, shop: string): Promise<Product | undefined>;
  /** Throws DuplicateProductError when R-003 would be broken. */
  add(product: NewProduct): Promise<Product>;
  /** Any product by id, in any state (ADR-010/C-003). */
  get(id: string): Promise<ProductRecord | undefined>;
  /** Selectable or soft-deleted products, ordered by name then shop ignoring letter case. Replaced versions never appear. */
  listByState(state: ListState): Promise<ProductRecord[]>;
  /**
   * Soft delete (R-006), deleted_at = at. Already deleted: returned unchanged. Undefined when the id is unknown.
   * Throws NotSelectableError when the product was replaced.
   */
  softDelete(id: string, at: Date): Promise<ProductRecord | undefined>;
  /**
   * Clears deleted_at. Already selectable: returned unchanged. Undefined when the id is unknown.
   * Throws DuplicateProductError when a selectable product has the same name and shop (R-003, R-006),
   * NotSelectableError when the product was replaced.
   */
  restore(id: string): Promise<ProductRecord | undefined>;
}

/** R-003: compare ignoring letter case and leading, trailing or repeated spaces. */
export function normaliseKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export class InMemoryProductStore implements ProductStore {
  private readonly items: Product[] = [];
  private readonly states = new Map<string, ProductState>();

  constructor(private readonly newId: () => string) {}

  private stateOf(id: string): ProductState {
    return this.states.get(id) ?? SELECTABLE_STATE;
  }

  async findSelectable(name: string, shop: string): Promise<Product | undefined> {
    const n = normaliseKey(name);
    const s = normaliseKey(shop);
    return this.items.find(
      (p) => isSelectable(this.stateOf(p.id)) && normaliseKey(p.name) === n && normaliseKey(p.shop) === s,
    );
  }

  async add(product: NewProduct): Promise<Product> {
    if (await this.findSelectable(product.name, product.shop)) {
      throw new DuplicateProductError("duplicate name and shop");
    }
    const saved: Product = { ...product, id: this.newId() };
    this.items.push(saved);
    return saved;
  }

  async get(id: string): Promise<ProductRecord | undefined> {
    const product = this.items.find((p) => p.id === id);
    return product ? { product, state: this.stateOf(id) } : undefined;
  }

  async listByState(state: ListState): Promise<ProductRecord[]> {
    const key = (p: Product): string => `${p.name.toLowerCase()}\u0000${p.shop.toLowerCase()}`;
    return this.items
      .map((product) => ({ product, state: this.stateOf(product.id) }))
      .filter((r) => (state === "selectable" ? isSelectable(r.state) : r.state.deleted_at !== null))
      .sort((a, b) => (key(a.product) < key(b.product) ? -1 : key(a.product) > key(b.product) ? 1 : 0));
  }

  async softDelete(id: string, at: Date): Promise<ProductRecord | undefined> {
    const record = await this.get(id);
    if (!record) return undefined;
    if (record.state.replaced_by !== null) throw new NotSelectableError("replaced by a newer version");
    if (record.state.deleted_at === null) this.states.set(id, { replaced_by: null, deleted_at: at });
    return this.get(id);
  }

  async restore(id: string): Promise<ProductRecord | undefined> {
    const record = await this.get(id);
    if (!record) return undefined;
    if (record.state.replaced_by !== null) throw new NotSelectableError("replaced by a newer version");
    if (record.state.deleted_at !== null) {
      if (await this.findSelectable(record.product.name, record.product.shop)) {
        throw new DuplicateProductError("duplicate name and shop");
      }
      this.states.delete(id);
    }
    return this.get(id);
  }

  /** Test seeding only (CMP-002 seeding_cleanup): sets a state, for example a replaced product. */
  seedState(id: string, state: ProductState): void {
    this.states.set(id, state);
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
  /** The clock seam: deleted_at comes from here (CMP-002 seam_clock). Default: the system clock. */
  clock?: () => Date;
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

const LIST_STATES: readonly string[] = ["selectable", "deleted"];

function notFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendError(request, reply, 404, "product.not_found", "No product has this id.");
}

/** Runs a state change on the product named by the :id path parameter and maps its outcomes to IF-001 (R-006). */
async function changeState(
  request: FastifyRequest,
  reply: FastifyReply,
  run: (id: string) => Promise<ProductRecord | undefined>,
): Promise<FastifyReply> {
  try {
    const record = await run((request.params as { id: string }).id);
    if (!record) return notFound(request, reply);
    return reply.code(200).send(toProductResponse(record.product, record.state));
  } catch (error) {
    if (error instanceof NotSelectableError) {
      return sendError(request, reply, 409, "product.not_selectable", "The product was replaced by a newer version.");
    }
    if (error instanceof DuplicateProductError) {
      return sendError(
        request,
        reply,
        409,
        "product.duplicate_name_shop",
        "A product with that name and shop already exists.",
      );
    }
    throw error;
  }
}

export function registerProductRoutes(app: FastifyInstance, deps: ProductRouteDeps): void {
  const clock = deps.clock ?? ((): Date => new Date());

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

  // IF-001@1.2.0 listProducts: selectable by default, soft-deleted with state=deleted (R-004, R-006).
  app.get("/products", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return refuseUnauthorised(request, reply);

    const asked = (request.query as { state?: unknown }).state ?? "selectable";
    if (typeof asked !== "string" || !LIST_STATES.includes(asked)) {
      return sendError(request, reply, 400, "request.invalid", "state must be selectable or deleted.");
    }
    const records = await deps.store.listByState(asked as ListState);
    return reply.code(200).send(records.map((r) => toProductResponse(r.product, r.state)));
  });

  // IF-001@1.2.0 getProduct: any product by id, in any state (ADR-010/C-003).
  app.get("/products/:id", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return refuseUnauthorised(request, reply);
    return changeState(request, reply, (id) => deps.store.get(id));
  });

  // IF-001@1.2.0 deleteProduct: soft delete, deleted_at from the injected clock (R-006).
  app.delete("/products/:id", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return refuseUnauthorised(request, reply);
    return changeState(request, reply, (id) => deps.store.softDelete(id, clock()));
  });

  // IF-001@1.2.0 restoreProduct: refused when a selectable product has the same name and shop (R-003, R-006).
  app.post("/products/:id/restore", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return refuseUnauthorised(request, reply);
    return changeState(request, reply, (id) => deps.store.restore(id));
  });
}
