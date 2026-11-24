// Pure flow logic: which screen follows each response, validation, the createProduct body,
// and the signed-in hint. No browser needed.

import {
  REQUIRED_FIELDS,
  type MissingField,
  type NewProduct,
  type Product,
  type ProductResult,
  type Recognised,
} from "./api";

export type Screen =
  | { name: "login"; error: string | null }
  | { name: "add" }
  | { name: "busy" }
  | { name: "saved"; product: Product }
  | { name: "missing"; missing: MissingField[]; recognised: Recognised }
  | { name: "duplicate"; message: string | null }
  | { name: "failed"; message: string | null };

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// A hint only: no token, no password, no expiry. The session is the server's cookie.
export const SIGNED_IN_KEY = "dc.signedIn";

export function isSignedIn(storage: KeyValueStorage | null): boolean {
  try {
    return storage?.getItem(SIGNED_IN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSignedIn(storage: KeyValueStorage | null): void {
  try {
    storage?.setItem(SIGNED_IN_KEY, "1");
  } catch {
    // Storage unavailable: behave as if the flag is absent.
  }
}

export function clearSignedIn(storage: KeyValueStorage | null): void {
  try {
    storage?.removeItem(SIGNED_IN_KEY);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

export function initialScreen(storage: KeyValueStorage | null): Screen {
  return isSignedIn(storage) ? { name: "add" } : { name: "login", error: null };
}

// The fields to ask for: those the server lists, plus any required one it neither listed nor recognised.
function fieldsToAsk(missing: MissingField[], recognised: Recognised): MissingField[] {
  return REQUIRED_FIELDS.filter((f) => missing.includes(f) || recognised[f] === undefined);
}

export function screenAfterProduct(result: ProductResult): Screen {
  switch (result.kind) {
    case "saved":
      return { name: "saved", product: result.product };
    case "values_missing":
      return {
        name: "missing",
        missing: fieldsToAsk(result.missing, result.recognised),
        recognised: result.recognised,
      };
    case "duplicate":
      return { name: "duplicate", message: result.message };
    case "unauthorized":
      return { name: "login", error: null };
    case "failed":
      return { name: "failed", message: result.message };
  }
}

// Accepts 12.5 and 12,5. Rejects negatives, signs, exponents and anything that is not a number.
export function parseDecimal(text: string): number | null {
  const t = text.trim();
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export type FieldErrors = Partial<Record<MissingField, string>>;

export type BuildResult =
  | { ok: true; product: NewProduct }
  | { ok: false; errors: FieldErrors };

export const NUMBER_ERROR = "Enter a number, 0 or more";
export const TEXT_ERROR = "This is required";

// Recognised values plus the supplied ones, source "label". Nothing is built until every asked value is valid.
export function buildNewProduct(
  recognised: Recognised,
  missing: MissingField[],
  supplied: Partial<Record<MissingField, string>>,
): BuildResult {
  const errors: FieldErrors = {};
  const values: Recognised = { ...recognised };
  for (const f of missing) {
    const raw = supplied[f] ?? "";
    if (f === "name" || f === "shop") {
      const t = raw.trim();
      if (t === "") errors[f] = TEXT_ERROR;
      else values[f] = t;
    } else {
      const n = parseDecimal(raw);
      if (n === null) errors[f] = NUMBER_ERROR;
      else values[f] = n;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const { name, shop, calories, protein, fat } = values;
  if (name === undefined || shop === undefined || calories === undefined || protein === undefined || fat === undefined) {
    const rest: FieldErrors = {};
    for (const f of REQUIRED_FIELDS) {
      if (values[f] === undefined) rest[f] = f === "name" || f === "shop" ? TEXT_ERROR : NUMBER_ERROR;
    }
    return { ok: false, errors: rest };
  }
  const product: NewProduct = { name, shop, calories, protein, fat, source: "label" };
  if (typeof recognised.brand === "string" && recognised.brand !== "") product.brand = recognised.brand;
  return { ok: true, product };
}
