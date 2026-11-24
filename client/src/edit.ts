// Edit a product (REQ-005, IF-001@1.2.0 editProduct): the prefilled form values, the patch of changed
// fields, and the screen that follows each answer. Pure logic, no browser needed.

import { OPTIONAL_NUMBER_FIELDS, type EditResult, type Product, type ProductUpdate } from "./api";
import {
  MANUAL_FIELDS,
  MANUAL_FAILED_TEXT,
  NUMBER_ERROR,
  TEXT_ERROR,
  parseDecimal,
  type ChangeOutcome,
  type ManualErrors,
  type ManualField,
  type ManualValues,
} from "./flow";

export const SAVED_NEW_VERSION_TEXT = "Saved as a new version; the old one is kept for past days";
export const SAVED_TEXT = "Saved";
export const NO_CHANGES_TEXT = "Nothing was changed. Nothing was sent.";
export const EDIT_DUPLICATE_TEXT = "A product with that name and shop already exists";
export const EDIT_CHANGED_TEXT = "This product changed meanwhile";

// 12.5 is shown as 12,5. Very small numbers avoid the exponent form, which the form would not accept.
export function formatNumber(n: number): string {
  let s = String(n);
  if (/e/i.test(s)) s = n.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  return s.replace(".", ",");
}

// The form values for a product: its own values, numbers with a comma decimal, empty where unset.
export function productToValues(p: Product): ManualValues {
  const values: ManualValues = {
    name: p.name,
    shop: p.shop,
    brand: p.brand ?? "",
    calories: formatNumber(p.calories),
    protein: formatNumber(p.protein),
    fat: formatNumber(p.fat),
  };
  for (const f of OPTIONAL_NUMBER_FIELDS) {
    const v = p[f];
    values[f] = v === undefined ? "" : formatNumber(v);
  }
  return values;
}

export type PatchResult = { ok: true; patch: ProductUpdate } | { ok: false; errors: ManualErrors };

// Only the changed fields. A cleared optional field is null. An empty patch means nothing changed.
export function buildPatch(original: Product, values: ManualValues): PatchResult {
  const errors: ManualErrors = {};
  const patch: ProductUpdate = {};
  for (const f of ["name", "shop"] as const) {
    const t = (values[f] ?? "").trim();
    if (t === "") errors[f] = TEXT_ERROR;
    else if (t !== original[f]) patch[f] = t;
  }
  const brand = (values.brand ?? "").trim();
  if (brand !== (original.brand ?? "")) patch.brand = brand === "" ? null : brand;
  for (const f of ["calories", "protein", "fat"] as const) {
    const raw = (values[f] ?? "").trim();
    if (raw === "") {
      errors[f] = TEXT_ERROR;
      continue;
    }
    const n = parseDecimal(raw);
    if (n === null) errors[f] = NUMBER_ERROR;
    else if (n !== original[f]) patch[f] = n;
  }
  for (const f of OPTIONAL_NUMBER_FIELDS) {
    const raw = (values[f] ?? "").trim();
    const old = original[f];
    if (raw === "") {
      if (old !== undefined) patch[f] = null;
      continue;
    }
    const n = parseDecimal(raw);
    if (n === null) errors[f] = NUMBER_ERROR;
    else if (n !== old) patch[f] = n;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, patch };
}

function isManualField(x: string): x is ManualField {
  return (MANUAL_FIELDS as readonly string[]).includes(x);
}

// What follows editProduct. The form stays filled on a refusal that the Owner can fix.
export function editOutcome(result: EditResult, values: ManualValues, original: Product): ChangeOutcome {
  const keep = (errors: ManualErrors, notice: string | null): ChangeOutcome => ({
    kind: "screen",
    screen: { name: "edit", product: original, values, errors, notice },
  });
  switch (result.kind) {
    case "ok":
      return {
        kind: "screen",
        screen: {
          name: "product",
          product: result.product,
          confirmDelete: false,
          notice: result.versioned ? SAVED_NEW_VERSION_TEXT : SAVED_TEXT,
        },
      };
    case "values_missing": {
      const errors: ManualErrors = {};
      for (const f of result.missing) errors[f] = TEXT_ERROR;
      return keep(errors, null);
    }
    case "value_invalid": {
      const errors: ManualErrors = {};
      for (const f of result.invalid) if (isManualField(f)) errors[f] = NUMBER_ERROR;
      return keep(errors, Object.keys(errors).length > 0 ? null : (result.message ?? MANUAL_FAILED_TEXT));
    }
    case "duplicate":
      return keep({}, EDIT_DUPLICATE_TEXT);
    case "not_selectable":
    case "not_found":
      return { kind: "reload", view: "selectable", notice: EDIT_CHANGED_TEXT };
    case "unauthorized":
      return { kind: "screen", screen: { name: "login", error: null } };
    case "failed":
      return keep({}, result.message ?? MANUAL_FAILED_TEXT);
  }
}
