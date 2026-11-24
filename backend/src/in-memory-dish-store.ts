import {
  DishNotSelectableError,
  isDishSelectable,
  sameLines,
  type DishChanges,
  type DishEditOutcome,
  type DishRecord,
  type DishState,
  type DishStore,
  type NewDish,
} from "./dish-store.js";
import type { ListState } from "./products.js";

const SELECTABLE_STATE: DishState = { replaced_by: null, deleted_at: null };

/** A fake DishStore for unit tests. It follows the contract of DishStore and uses the same selectable predicate. */
export class InMemoryDishStore implements DishStore {
  private readonly dishes: DishRecord[] = [];

  constructor(private readonly newId: () => string) {}

  async add(dish: NewDish, _at: Date): Promise<DishRecord> {
    const record: DishRecord = {
      dish: {
        id: this.newId(),
        name: dish.name,
        lines: dish.lines.map((line, position) => ({ ...line, position })),
      },
      state: { ...SELECTABLE_STATE },
    };
    this.dishes.push(record);
    return record;
  }

  async get(id: string): Promise<DishRecord | undefined> {
    return this.dishes.find((r) => r.dish.id === id);
  }

  async listByState(state: ListState): Promise<DishRecord[]> {
    const key = (r: DishRecord): string => `${r.dish.name.toLowerCase()}\u0000${r.dish.id}`;
    return this.dishes
      .filter((r) => (state === "selectable" ? isDishSelectable(r.state) : r.state.deleted_at !== null))
      .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }

  async softDelete(id: string, at: Date): Promise<DishRecord | undefined> {
    const record = await this.get(id);
    if (!record) return undefined;
    if (record.state.replaced_by !== null) throw new DishNotSelectableError("replaced by a newer version");
    if (record.state.deleted_at === null) record.state = { replaced_by: null, deleted_at: at };
    return record;
  }

  async restore(id: string): Promise<DishRecord | undefined> {
    const record = await this.get(id);
    if (!record) return undefined;
    if (record.state.replaced_by !== null) throw new DishNotSelectableError("replaced by a newer version");
    record.state = { replaced_by: null, deleted_at: null };
    return record;
  }

  async edit(id: string, changes: DishChanges, at: Date): Promise<DishEditOutcome | undefined> {
    const record = await this.get(id);
    if (!record) return undefined;
    if (!isDishSelectable(record.state)) throw new DishNotSelectableError("replaced or deleted");
    const linesChanged = changes.lines !== undefined && !sameLines(record.dish.lines, changes.lines);
    const nameChanged = changes.name !== undefined && changes.name !== record.dish.name;
    if (linesChanged && changes.lines) {
      const created = await this.add({ name: changes.name ?? record.dish.name, lines: changes.lines }, at);
      record.state = { replaced_by: created.dish.id, deleted_at: null };
      return { record: created, versioned: true, replaced_id: id };
    }
    if (nameChanged && changes.name !== undefined) {
      record.dish = { ...record.dish, name: changes.name };
    }
    return { record, versioned: false, replaced_id: null };
  }

  /** Test seeding only: sets a state, for example a replaced dish. */
  seedState(id: string, state: DishState): void {
    const record = this.dishes.find((r) => r.dish.id === id);
    if (record) record.state = state;
  }
}
