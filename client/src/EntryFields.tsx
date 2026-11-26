import type { Product } from "./api";
import type { Dish } from "./dishApi";
import type { FormValues } from "./planLogic";

export interface EntryFieldsProps {
  values: FormValues;
  products: Product[];
  dishes: Dish[];
  testIds: { select: string; grams: string; pieces: string };
  onValues: (values: FormValues) => void;
}

/** The product or dish picker with the grams and pieces inputs, shared by the plan and log screens. */
export function EntryFields(props: EntryFieldsProps) {
  const { values } = props;
  return (
    <>
      <select
        aria-label="Product or dish"
        value={values.subject}
        onChange={(e) => props.onValues({ ...values, subject: e.target.value })}
        data-testid={props.testIds.select}
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
        onChange={(e) => props.onValues({ ...values, grams: e.target.value })}
        data-testid={props.testIds.grams}
      />
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label="Pieces"
        placeholder="Pieces"
        value={values.pieces}
        onChange={(e) => props.onValues({ ...values, pieces: e.target.value })}
        data-testid={props.testIds.pieces}
      />
    </>
  );
}
