// IF-001@1.2.0 client. The fetch function and the run-id source are injected (AGENTS.md).
// Types follow architecture/system/interfaces/IF-001/openapi-1.2.0.json.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const REQUIRED_FIELDS = ["name", "shop", "calories", "protein", "fat"] as const;
export type MissingField = (typeof REQUIRED_FIELDS)[number];

export const OPTIONAL_NUMBER_FIELDS = [
  "carbohydrate",
  "sugars",
  "fibre",
  "salt",
  "portion_size",
  "portion_calories",
  "piece_weight",
] as const;
export type OptionalNumberField = (typeof OPTIONAL_NUMBER_FIELDS)[number];
export type OptionalNumbers = Partial<Record<OptionalNumberField, number>>;

export interface Recognised extends OptionalNumbers {
  name?: string;
  shop?: string;
  calories?: number;
  protein?: number;
  fat?: number;
  brand?: string;
}

export interface NewProduct extends OptionalNumbers {
  name: string;
  shop: string;
  calories: number;
  protein: number;
  fat: number;
  brand?: string;
  source: "label" | "lookup" | "manual";
}

export interface Product extends NewProduct {
  id: string;
  /** mg per 100 g, computed by the server (R-001). */
  sodium?: number;
  /** True when a piece weight is stored (R-003). */
  counted_by_piece?: boolean;
  /** True when soft-deleted (R-006), IF-001@1.2.0. */
  deleted?: boolean;
  /** True when it can be chosen for new plans and log entries, IF-001@1.2.0. */
  selectable?: boolean;
}

export type ProductResult =
  | { kind: "saved"; product: Product }
  | { kind: "values_missing"; missing: MissingField[]; recognised: Recognised }
  | { kind: "value_invalid"; invalid: string[]; message: string | null }
  | { kind: "duplicate"; message: string | null }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string | null };

export type LoginResult =
  | { kind: "ok" }
  | { kind: "rejected"; message: string | null }
  | { kind: "failed"; message: string | null };

/** Which products listProducts returns (IF-001@1.2.0). */
export type ProductState = "selectable" | "deleted";

export type ListResult =
  | { kind: "ok"; products: Product[] }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string | null };

/** The answer to deleteProduct or restoreProduct. */
export type ChangeResult =
  | { kind: "ok"; product: Product }
  | { kind: "duplicate"; message: string | null }
  | { kind: "not_selectable"; message: string | null }
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string | null };

export interface Api {
  loginOwner(password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  addProductFromLabelPhoto(photo: Blob): Promise<ProductResult>;
  createProduct(product: NewProduct): Promise<ProductResult>;
  listProducts(state: ProductState): Promise<ListResult>;
  deleteProduct(id: string): Promise<ChangeResult>;
  restoreProduct(id: string): Promise<ChangeResult>;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function messageOf(body: unknown): string | null {
  if (isRecord(body) && typeof body.message === "string" && body.message !== "") {
    return body.message;
  }
  return null;
}

function num(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

function str(x: unknown): string | undefined {
  return typeof x === "string" ? x : undefined;
}

function copyOptionals(raw: Record<string, unknown>, out: OptionalNumbers): void {
  for (const key of OPTIONAL_NUMBER_FIELDS) {
    const value = num(raw[key]);
    if (value !== undefined) out[key] = value;
  }
}

function parseRecognised(raw: unknown): Recognised {
  if (!isRecord(raw)) return {};
  const out: Recognised = {};
  const name = str(raw.name);
  const shop = str(raw.shop);
  const brand = str(raw.brand);
  const calories = num(raw.calories);
  const protein = num(raw.protein);
  const fat = num(raw.fat);
  if (name !== undefined) out.name = name;
  if (shop !== undefined) out.shop = shop;
  if (brand !== undefined) out.brand = brand;
  if (calories !== undefined) out.calories = calories;
  if (protein !== undefined) out.protein = protein;
  if (fat !== undefined) out.fat = fat;
  copyOptionals(raw, out);
  return out;
}

function parseMissing(raw: unknown): MissingField[] {
  if (!Array.isArray(raw)) return [];
  return REQUIRED_FIELDS.filter((f) => raw.includes(f));
}

function parseProduct(raw: unknown): Product | null {
  if (!isRecord(raw)) return null;
  const { id, name, shop, calories, protein, fat, source } = raw;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof shop !== "string" ||
    typeof calories !== "number" ||
    typeof protein !== "number" ||
    typeof fat !== "number" ||
    (source !== "label" && source !== "lookup" && source !== "manual")
  ) {
    return null;
  }
  const product: Product = { id, name, shop, calories, protein, fat, source };
  if (typeof raw.brand === "string") product.brand = raw.brand;
  copyOptionals(raw, product);
  const sodium = num(raw.sodium);
  if (sodium !== undefined) product.sodium = sodium;
  if (typeof raw.counted_by_piece === "boolean") product.counted_by_piece = raw.counted_by_piece;
  if (typeof raw.deleted === "boolean") product.deleted = raw.deleted;
  if (typeof raw.selectable === "boolean") product.selectable = raw.selectable;
  return product;
}

async function productResult(res: Response): Promise<ProductResult> {
  const body = await readBody(res);
  if (res.status === 201) {
    const product = parseProduct(body);
    return product ? { kind: "saved", product } : { kind: "failed", message: null };
  }
  if (res.status === 401) return { kind: "unauthorized" };
  if (res.status === 409) return { kind: "duplicate", message: messageOf(body) };
  if (res.status === 400 && isRecord(body) && body.code === "product.value_invalid") {
    const invalid = Array.isArray(body.invalid)
      ? body.invalid.filter((x): x is string => typeof x === "string")
      : [];
    return { kind: "value_invalid", invalid, message: messageOf(body) };
  }
  if (res.status === 422) {
    const b = isRecord(body) ? body : {};
    return {
      kind: "values_missing",
      missing: parseMissing(b.missing),
      recognised: parseRecognised(b.recognised),
    };
  }
  return { kind: "failed", message: messageOf(body) };
}

async function listResult(res: Response): Promise<ListResult> {
  if (res.status === 401) return { kind: "unauthorized" };
  const body = await readBody(res);
  if (res.status === 200 && Array.isArray(body)) {
    const products: Product[] = [];
    for (const raw of body) {
      const product = parseProduct(raw);
      if (product) products.push(product);
    }
    return { kind: "ok", products };
  }
  return { kind: "failed", message: messageOf(body) };
}

async function changeResult(res: Response): Promise<ChangeResult> {
  const body = await readBody(res);
  if (res.status === 200) {
    const product = parseProduct(body);
    return product ? { kind: "ok", product } : { kind: "failed", message: null };
  }
  if (res.status === 401) return { kind: "unauthorized" };
  if (res.status === 404) return { kind: "not_found" };
  if (res.status === 409 && isRecord(body)) {
    if (body.code === "product.duplicate_name_shop") return { kind: "duplicate", message: messageOf(body) };
    if (body.code === "product.not_selectable") return { kind: "not_selectable", message: messageOf(body) };
  }
  return { kind: "failed", message: messageOf(body) };
}

export function createApi(fetchFn: FetchLike, newRunId: () => string): Api {
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    "X-Run-Id": newRunId(),
    ...extra,
  });

  return {
    async loginOwner(password) {
      try {
        const res = await fetchFn("/auth/login", {
          method: "POST",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ password }),
        });
        if (res.status === 204) return { kind: "ok" };
        const message = messageOf(await readBody(res));
        if (res.status === 401 || res.status === 429) return { kind: "rejected", message };
        return { kind: "failed", message };
      } catch {
        return { kind: "failed", message: null };
      }
    },

    async logout() {
      try {
        await fetchFn("/auth/logout", { method: "POST", headers: headers() });
      } catch {
        // The client clears its hint either way; the server session expires on its own.
      }
    },

    async addProductFromLabelPhoto(photo) {
      try {
        const form = new FormData();
        form.append("photo", photo);
        const res = await fetchFn("/products/label-photo", {
          method: "POST",
          headers: headers(),
          body: form,
        });
        return await productResult(res);
      } catch {
        return { kind: "failed", message: null };
      }
    },

    async createProduct(product) {
      try {
        const res = await fetchFn("/products", {
          method: "POST",
          headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify(product),
        });
        return await productResult(res);
      } catch {
        return { kind: "failed", message: null };
      }
    },

    async listProducts(state) {
      try {
        const url = state === "deleted" ? "/products?state=deleted" : "/products";
        const res = await fetchFn(url, { method: "GET", headers: headers() });
        return await listResult(res);
      } catch {
        return { kind: "failed", message: null };
      }
    },

    async deleteProduct(id) {
      try {
        const res = await fetchFn(`/products/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
        return await changeResult(res);
      } catch {
        return { kind: "failed", message: null };
      }
    },

    async restoreProduct(id) {
      try {
        const res = await fetchFn(`/products/${encodeURIComponent(id)}/restore`, {
          method: "POST",
          headers: headers(),
        });
        return await changeResult(res);
      } catch {
        return { kind: "failed", message: null };
      }
    },
  };
}
