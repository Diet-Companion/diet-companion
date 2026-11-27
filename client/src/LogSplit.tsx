import type { Dish } from "./dishApi";
import type { SplitForm } from "./logScreenLogic";
import type { Meal } from "./planApi";

export interface LogSplitProps {
  meal: Meal;
  /** The open form of the meal, or undefined when closed. */
  form: SplitForm | undefined;
  dishes: Dish[];
  busy: boolean;
  onOpen: () => void;
  onDish: (dishId: string) => void;
  onLine: (position: number, values: { grams: string; pieces: string }) => void;
  onSave: () => void;
}

// "Log dish as products": pick a dish, see its lines with the dish amounts prefilled, change any amount, save.
export function LogSplit(props: LogSplitProps) {
  const { meal, form } = props;
  return (
    <>
      <button type="button" disabled={props.busy} onClick={props.onOpen} data-testid={`log-split-dish-${meal}`}>
        Log dish as products
      </button>
      {form ? (
        <form
          noValidate
          data-testid={`log-split-form-${meal}`}
          onSubmit={(e) => {
            e.preventDefault();
            props.onSave();
          }}
        >
          <select
            aria-label="Dish to split"
            value={form.dishId}
            onChange={(e) => props.onDish(e.target.value)}
            data-testid={`log-split-select-${meal}`}
          >
            <option value="">Choose a dish</option>
            {props.dishes.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <ul>
            {form.lines.map((l) => (
              <li key={l.position} data-testid={`log-split-line-${meal}-${l.position}`}>
                <span>{l.name}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={`Grams of ${l.name}`}
                  placeholder="Grams"
                  value={l.grams}
                  onChange={(e) => props.onLine(l.position, { grams: e.target.value, pieces: l.pieces })}
                  data-testid={`log-split-grams-${meal}-${l.position}`}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={`Pieces of ${l.name}`}
                  placeholder="Pieces"
                  value={l.pieces}
                  onChange={(e) => props.onLine(l.position, { grams: l.grams, pieces: e.target.value })}
                  data-testid={`log-split-pieces-${meal}-${l.position}`}
                />
                {form.refused[l.position] !== undefined ? (
                  <span
                    data-testid={`log-split-line-error-${meal}-${l.position}`}
                    data-reason={form.refused[l.position]}
                  >
                    Check this line
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <button type="submit" disabled={props.busy} data-testid={`log-split-save-${meal}`}>
            Save as products
          </button>
        </form>
      ) : null}
    </>
  );
}
