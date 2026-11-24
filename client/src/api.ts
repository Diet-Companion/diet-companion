// IF-001@1.0.0 client. The fetch function and the run-id source are injected (AGENTS.md).
// Types follow architecture/system/interfaces/IF-001/openapi.json.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const REQUIRED_FIELDS = ["name", "shop", "calories", "protein", "fat"] as const;
export type MissingField = (typeof REQUIRED_FIELDS)[number];

export interface Recognised {
  name?: string;
  shop?: string;
  calories?: number;
  protein?: number;
  fat?: number;
  brand?: string;
}

export interface NewProduct {
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
}

export type ProductResult =
  | { kind: "saved"; product: Product }
  | { kind: "values_missing"; missing: MissingField[]; recognised: Recognised }
  | { kind: "duplicate"; message: string | null }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string | null };

export type LoginResult =
  | { kind: "ok" }
  | { kind: "rejected"; message: string | null }
  | { kind: "failed"; message: string | null };

export interface Api {
  loginOwner(password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  addProductFromLabelPhoto(photo: Blob): Promise<ProductResult>;
  createProduct(product: NewProduct): Promise<ProductResult>;
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
  };
}
