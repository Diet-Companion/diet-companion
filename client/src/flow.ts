// Pure flow logic: which screen follows each response, validation, the createProduct body,
// and the signed-in hint. No browser needed.

import {
  OPTIONAL_NUMBER_FIELDS,
  REQUIRED_FIELDS,
  type MissingField,
  type NewProduct,
  type OptionalNumberField,
  type Product,
  type ProductResult,
  type Recognised,
} from "./api";

export const MANUAL_FIELDS = [
  "name",
  "shop",
  "brand",
  "calories",
  "protein",
  "fat",
  "carbohydrate",
  "sugars",
  "fibre",
  "salt",
  "portion_size",
  "portion_calories",
  "piece_weight",
] as const;
export type ManualField = (typeof MANUAL_FIELDS)[number];
export type ManualValues = Partial<Record<ManualField, string>>;
export type ManualErrors = Partial<Record<ManualField, string>>;

export type Screen =
  | { name: "login"; error: string | null }
  | { name: "add" }
  | { name: "busy" }
  | { name: "saved"; product: Product }
  | { name: "missing"; missing: MissingField[]; recognised: Recognised }
  | { name: "manual"; values: ManualValues; errors: ManualErrors; notice: string | null }
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
    case "value_invalid":
      return { name: "failed", message: result.message };
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
export const MANUAL_DUPLICATE_TEXT = "A product with that name and shop already exists. Nothing was saved.";
export const MANUAL_FAILED_TEXT = "The product could not be saved. Check the values and try again.";

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
  for (const key of OPTIONAL_NUMBER_FIELDS) {
    const value = recognised[key];
    if (value !== undefined) product[key] = value;
  }
  return { ok: true, product };
}

export type ManualBuildResult =
  | { ok: true; product: NewProduct }
  | { ok: false; errors: ManualErrors };

// The hand-entry form: required name, shop, calories, protein and fat; optional rest left out when empty.
// The server's answer still decides (REQ-002, R-002).
export function buildManualProduct(values: ManualValues): ManualBuildResult {
  const errors: ManualErrors = {};
  const name = (values.name ?? "").trim();
  const shop = (values.shop ?? "").trim();
  const brand = (values.brand ?? "").trim();
  if (name === "") errors.name = TEXT_ERROR;
  if (shop === "") errors.shop = TEXT_ERROR;

  const required: Partial<Record<"calories" | "protein" | "fat", number>> = {};
  for (const f of ["calories", "protein", "fat"] as const) {
    const raw = (values[f] ?? "").trim();
    if (raw === "") {
      errors[f] = TEXT_ERROR;
      continue;
    }
    const n = parseDecimal(raw);
    if (n === null) errors[f] = NUMBER_ERROR;
    else required[f] = n;
  }

  const optional: Partial<Record<OptionalNumberField, number>> = {};
  for (const f of OPTIONAL_NUMBER_FIELDS) {
    const raw = (values[f] ?? "").trim();
    if (raw === "") continue;
    const n = parseDecimal(raw);
    if (n === null) errors[f] = NUMBER_ERROR;
    else optional[f] = n;
  }

  const { calories, protein, fat } = required;
  if (Object.keys(errors).length > 0 || calories === undefined || protein === undefined || fat === undefined) {
    return { ok: false, errors };
  }
  const product: NewProduct = { name, shop, calories, protein, fat, source: "manual" };
  if (brand !== "") product.brand = brand;
  for (const f of OPTIONAL_NUMBER_FIELDS) {
    const n = optional[f];
    if (n !== undefined) product[f] = n;
  }
  return { ok: true, product };
}

function isManualField(x: string): x is ManualField {
  return (MANUAL_FIELDS as readonly string[]).includes(x);
}

// The screen after createProduct on the hand-entry form: the form stays filled on every refusal.
export function screenAfterManual(result: ProductResult, values: ManualValues): Screen {
  const keep = (errors: ManualErrors, notice: string | null): Screen => ({
    name: "manual",
    values,
    errors,
    notice,
  });
  switch (result.kind) {
    case "saved":
      return { name: "saved", product: result.product };
    case "values_missing": {
      const errors: ManualErrors = {};
      for (const f of result.missing) errors[f] = TEXT_ERROR;
      return keep(errors, null);
    }
    case "value_invalid": {
      const errors: ManualErrors = {};
      for (const f of result.invalid) if (isManualField(f)) errors[f] = NUMBER_ERROR;
      return keep(errors, null);
    }
    case "duplicate":
      return keep({}, MANUAL_DUPLICATE_TEXT);
    case "unauthorized":
      return { name: "login", error: null };
    case "failed":
      return keep({}, result.message ?? MANUAL_FAILED_TEXT);
  }
}
