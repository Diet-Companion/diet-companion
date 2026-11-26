/** The five meals of a day, in day order (IF-001@1.5.0 Meal). */
export const MEALS = ["breakfast", "brunch", "lunch", "afternoon_snack", "dinner"] as const;
export type Meal = (typeof MEALS)[number];

export function isMeal(value: unknown): value is Meal {
  return typeof value === "string" && (MEALS as readonly string[]).includes(value);
}

/** Plan rows and log rows share one table, told apart by kind (ADR-017/C-001). */
export type EntryKind = "plan" | "log";

/** One entry as saved (ADR-017/C-001). Exactly one of product_id and dish_id; a product row has one amount. */
export interface StoredEntry {
  id: string;
  meal: Meal;
  /** Order within the meal; a removal leaves a gap and the others keep their order. */
  position: number;
  product_id: string | null;
  dish_id: string | null;
  grams: number | null;
  pieces: number | null;
  from_dish_id: string | null;
}

/** An entry to add. The store generates the id and takes the next position in the day and meal (ADR-017/C-002). */
export type NewStoredEntry = Omit<StoredEntry, "id" | "position">;

/** The day is closed, so nothing about it changes (R-013, ADR-019/C-002, IF-001 day.closed). */
export class DayClosedError extends Error {}

/** Orders entries by meal in day order, then by position. */
export function sortEntries(entries: readonly StoredEntry[]): StoredEntry[] {
  return [...entries].sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.position - b.position);
}

/** What a change may do while the day row is locked. It acts on the rows of one day and one kind only. */
export interface PlanTx {
  /** Adds an entry with a new id at the next position of its meal. */
  add(entry: NewStoredEntry): Promise<StoredEntry>;
  /** An entry of this day by id, or undefined. */
  find(id: string): Promise<StoredEntry | undefined>;
  /** Sets the amount of a product entry (A-038): the only update after insert (ADR-017/C-002). Undefined when not found. */
  setAmount(id: string, amount: { grams: number | null; pieces: number | null }): Promise<StoredEntry | undefined>;
  /** Deletes the row (A-039). False when not found. */
  remove(id: string): Promise<boolean>;
  /** The entries of this day and meal in position order, of the kind of this change unless another kind is named. */
  list(meal: Meal, kind?: EntryKind): Promise<StoredEntry[]>;
}

/** One day of the plan or log as read: whether the day is closed, and its entries in meal and position order. */
export interface PlanDay {
  closed: boolean;
  entries: StoredEntry[];
}

/** Storage seam for the day plan and log. Only CMP-002 reaches the database (ADR-003/C-002). */
export interface PlanStore {
  /** The entries of any day, of one kind (plan by default). A day with no row is open and empty. Reads work on a closed day (ADR-019/C-002). */
  read(day: string, kind?: EntryKind): Promise<PlanDay>;
  /**
   * Runs `work` in one transaction (ADR-017/C-004). The day row is inserted if missing, then locked, and
   * DayClosedError is thrown before `work` runs when closed_at is set (ADR-019/C-001, C-002). Anything thrown by
   * `work` rolls everything back, including a day row made by this call, so a refused change saves nothing.
   * `at` is the creation time of the rows; the caller takes it from its clock. `kind` is the kind of rows the
   * change acts on (plan by default).
   */
  mutate<T>(day: string, at: Date, work: (tx: PlanTx) => Promise<T>, kind?: EntryKind): Promise<T>;
}
