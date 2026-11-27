import type { StoredRange, TargetStore } from "./target-store.js";

/** One range as stored in day_ranges when a day is closed (ADR-020/C-001). */
export type DayRange = Pick<StoredRange, "nutrient" | "minimum" | "maximum">;

/** Closing storage seam. The plan store implements it next to PlanStore (ADR-020/C-002). */
export interface DayCloser {
  /**
   * One transaction: insert the day row if missing, lock it, throw DayClosedError when closed_at is set, store the
   * ranges that `resolveRanges` returns (one row per nutrient), then set closed_at to `at`. Anything thrown rolls
   * everything back, including a day row made by this call.
   */
  closeDay(day: string, at: Date, resolveRanges: () => Promise<DayRange[]>): Promise<void>;
  /** closed_at of a day, or null when it is open or has no record. */
  closedAt(day: string): Promise<Date | null>;
  /** The ranges stored when the day was closed, in calories, protein, fat order; empty for an open day. */
  closedRanges(day: string): Promise<DayRange[]>;
  /** The closed dates from `from` (inclusive) to `before` (exclusive), oldest first. */
  closedDays(from: string, before: string): Promise<string[]>;
  /** The earliest date with a day record, or undefined. */
  firstRecordedDay(): Promise<string | undefined>;
}

export function isDayCloser(value: unknown): value is DayCloser {
  const candidate = value as Partial<Record<keyof DayCloser, unknown>> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.closeDay === "function" &&
    typeof candidate.closedAt === "function" &&
    typeof candidate.closedRanges === "function" &&
    typeof candidate.closedDays === "function" &&
    typeof candidate.firstRecordedDay === "function"
  );
}

/** closed_at of a day as an ISO string for the day sheets (IF-001@1.6.0); null when open or when the store cannot close days. */
export async function closedAtIso(plans: unknown, day: string): Promise<string | null> {
  if (!isDayCloser(plans)) return null;
  const at = await plans.closedAt(day);
  return at ? at.toISOString() : null;
}

/**
 * The first day of use (A-042): the earliest date with a saved range or a day record, never later than today,
 * and today when nothing is recorded. Today comes from ADR-016's function, passed in by the caller.
 */
export async function firstDayOfUse(targets: TargetStore, closer: DayCloser, today: string): Promise<string> {
  const dates = [today];
  const range = await targets.earliestEffectiveFrom();
  if (range !== undefined) dates.push(range);
  const record = await closer.firstRecordedDay();
  if (record !== undefined) dates.push(record);
  return dates.reduce((earliest, date) => (date < earliest ? date : earliest));
}

/** The previous calendar day of a YYYY-MM-DD date. */
export function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
