/**
 * Candidate values read from a label photo, per 100 g (CMP-003, IF-001 NewProduct).
 * A field is null when the provider did not recognise it.
 */
export interface LabelValues {
  name: string | null;
  shop: string | null;
  calories: number | null;
  protein: number | null;
  fat: number | null;
  brand: string | null;
}

/**
 * The provider seam: read a label photo into nutrient values.
 * Later tickets implement it; tests pass a fake (AGENTS.md).
 * The photo is held in memory for the call only.
 */
export interface LabelProvider {
  readLabel(photo: Uint8Array, runId?: string): Promise<LabelValues>;
}
