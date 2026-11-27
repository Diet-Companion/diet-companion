import type { Product } from "./api";
import type { Dish } from "./dishApi";
import type { Meal } from "./planApi";
import type { FormValues } from "./planLogic";

export interface EntryFieldsProps {
  /** Test id prefix: plan-entry or log-entry. */
  prefix: string;
  meal: Meal;
  values: FormValues;
  products: Product[];
  dishes: Dish[];
  onChange: (values: FormValues) => void;
}

// The product or dish picker plus the grams and pieces inputs, shared by the plan and log views.
export function EntryFields(props: EntryFieldsProps) {
  const { prefix, meal, values } = props;
  return (
    <>
      <select
        aria-label="Product or dish"
        value={values.subject}
        onChange={(e) => props.onChange({ ...values, subject: e.target.value })}
        data-testid={`${prefix}-select-${meal}`}
      >
        <option value="">Choose a product or dish</option>
        <optgroup label="Products">
          {props.products.map((p) => (
            <option key={p.id} value={`p:${p.id}`}>
              {p.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Dishes">
          {props.dishes.map((d) => (
            <option key={d.id} value={`d:${d.id}`}>
              {d.name}
            </option>
          ))}
        </optgroup>
      </select>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label="Grams"
        placeholder="Grams"
        value={values.grams}
        onChange={(e) => props.onChange({ ...values, grams: e.target.value })}
        data-testid={`${prefix}-grams-${meal}`}
      />
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label="Pieces"
        placeholder="Pieces"
        value={values.pieces}
        onChange={(e) => props.onChange({ ...values, pieces: e.target.value })}
        data-testid={`${prefix}-pieces-${meal}`}
      />
    </>
  );
}
