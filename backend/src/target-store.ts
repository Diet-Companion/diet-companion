/** The nutrients that have a daily range (REQ-009/AC-008). */
export const TARGET_NUTRIENTS = ["calories", "protein", "fat"] as const;
export type TargetNutrient = (typeof TARGET_NUTRIENTS)[number];

export function isTargetNutrient(value: string): value is TargetNutrient {
  return (TARGET_NUTRIENTS as readonly string[]).includes(value);
}

/** One saved row (ADR-015 option a). effective_from is YYYY-MM-DD in the Owner zone. */
export interface StoredRange {
  nutrient: TargetNutrient;
  minimum: number;
  maximum: number;
  effective_from: string;
}

/** Target range storage seam (CMP-002 owns the table, ADR-003/C-002). */
export interface TargetStore {
  /** The row with the greatest effective_from not after date, or undefined (ADR-015/C-003). */
  rangeInForce(nutrient: TargetNutrient, date: string): Promise<StoredRange | undefined>;
  /** Inserts the row for (nutrient, effective_from) or overwrites it. Other rows are never touched (ADR-015/C-002). */
  save(range: StoredRange): Promise<StoredRange>;
}

export class InMemoryTargetStore implements TargetStore {
  private readonly rows = new Map<string, StoredRange>();

  async rangeInForce(nutrient: TargetNutrient, date: string): Promise<StoredRange | undefined> {
    let best: StoredRange | undefined;
    for (const row of this.rows.values()) {
      if (row.nutrient !== nutrient || row.effective_from > date) continue;
      if (!best || row.effective_from > best.effective_from) best = row;
    }
    return best ? { ...best } : undefined;
  }

  async save(range: StoredRange): Promise<StoredRange> {
    this.rows.set(`${range.nutrient}|${range.effective_from}`, { ...range });
    return { ...range };
  }
}
