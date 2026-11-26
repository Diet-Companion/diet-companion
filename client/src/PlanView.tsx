import { MEALS, type DaySheet, type Meal, type PlanEntry, type PlanError } from "./planApi";
import { MEAL_LABELS, EMPTY_FORM, errorText, formKey, markOf, type FormValues } from "./planLogic";

export interface Choice {
  id: string;
  name: string;
}

export interface PlanViewProps {
  sheets: DaySheet[];
  products: Choice[];
  dishes: Choice[];
  forms: Record<string, FormValues>;
  error: PlanError | null;
  onForm: (key: string, patch: Partial<FormValues>) => void;
  onSave: (date: string, meal: Meal) => void;
  onRemove: (date: string, entry: PlanEntry) => void;
  onBack: () => void;
}

function amountLine(e: PlanEntry): string {
  if (e.grams !== null) return `${e.grams} g`;
  if (e.pieces !== null) return `${e.pieces} pieces`;
  return "whole portion";
}

// One string, so the name, its mark and the amount render as one text node.
function entryText(e: PlanEntry): string {
  const subject = e.product ?? e.dish;
  const name = subject ? `${subject.name}${markOf(subject)}` : "";
  return `${name} - ${amountLine(e)}`;
}

export function PlanView(props: PlanViewProps) {
  return (
    <section data-testid="plan-screen">
      <h2>Daily plan</h2>
      {props.error ? (
        <p role="alert" data-testid="plan-error" data-code={props.error.code} data-reasons={props.error.reasons.join(",")}>
          {errorText(props.error)}
        </p>
      ) : null}
      {props.sheets.map((sheet) => (
        <section key={sheet.date} data-testid={`plan-day-${sheet.date}`}>
          <h3 data-testid="plan-day-date">{sheet.date}</h3>
          <p>{sheet.date === sheet.today ? "Today" : "Next day"}</p>
          {MEALS.map((meal) => {
            const key = formKey(sheet.date, meal);
            const form = props.forms[key] ?? EMPTY_FORM;
            const entries = sheet.meals.find((m) => m.meal === meal)?.entries ?? [];
            return (
              <div key={meal} data-testid={`plan-meal-${meal}`}>
                <h4>{MEAL_LABELS[meal]}</h4>
                <ul>
                  {entries.map((e) => (
                    <li key={e.id} data-testid={`plan-entry-row-${e.id}`}>
                      {entryText(e)}
                      <button type="button" data-testid={`plan-entry-remove-${e.id}`} onClick={() => props.onRemove(sheet.date, e)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <form
                  data-testid={`plan-entry-form-${meal}`}
                  noValidate
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    props.onSave(sheet.date, meal);
                  }}
                >
                  <select
                    aria-label={`${MEAL_LABELS[meal]}: product or dish`}
                    data-testid={`plan-entry-select-${meal}`}
                    value={form.subject}
                    onChange={(ev) => props.onForm(key, { subject: ev.target.value })}
                  >
                    <option value="">Choose...</option>
                    {props.products.map((p) => (
                      <option key={`p:${p.id}`} value={`p:${p.id}`}>
                        {p.name}
                      </option>
                    ))}
                    {props.dishes.map((d) => (
                      <option key={`d:${d.id}`} value={`d:${d.id}`}>
                        {`Dish: ${d.name}`}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label="Grams"
                    data-testid={`plan-entry-grams-${meal}`}
                    value={form.grams}
                    onChange={(ev) => props.onForm(key, { grams: ev.target.value })}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label="Pieces"
                    data-testid={`plan-entry-pieces-${meal}`}
                    value={form.pieces}
                    onChange={(ev) => props.onForm(key, { pieces: ev.target.value })}
                  />
                  <button type="submit" data-testid={`plan-entry-save-${meal}`}>
                    Add
                  </button>
                </form>
              </div>
            );
          })}
        </section>
      ))}
      <button type="button" onClick={props.onBack}>
        Back
      </button>
    </section>
  );
}
