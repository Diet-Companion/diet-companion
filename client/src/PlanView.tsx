import type { Product } from "./api";
import type { Dish } from "./dishApi";
import { MEALS, type DaySheet, type Meal, type PlanEntry, type PlanSubject } from "./planApi";
import { EMPTY_FORM, MEAL_LABELS, formKey, markOf, type FormValues } from "./planLogic";
import { amountText, type PlanState } from "./planScreenLogic";

export interface PlanViewProps {
  state: PlanState;
  products: Product[];
  dishes: Dish[];
  busy: boolean;
  onForm: (date: string, meal: Meal, values: FormValues) => void;
  onSubmit: (date: string, meal: Meal) => void;
  onEdit: (entryId: string, text: string) => void;
  onChange: (date: string, entry: PlanEntry) => void;
  onRemove: (date: string, entry: PlanEntry) => void;
  onBack: () => void;
}

function subjectText(s: PlanSubject): string {
  return `${s.name}${markOf(s)}`;
}

type RowProps = { date: string; entry: PlanEntry; edit: string | undefined } & Pick<
  PlanViewProps,
  "busy" | "onEdit" | "onChange" | "onRemove"
>;

function EntryRow(props: RowProps) {
  const { entry } = props;
  const subject = entry.dish ?? entry.product;
  return (
    <li data-testid={`plan-entry-row-${entry.id}`}>
      <span>{subject ? subjectText(subject) : ""}</span>
      {entry.dish ? (
        <span data-testid={`plan-entry-amount-${entry.id}`}>Whole dish</span>
      ) : (
        <>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={entry.pieces !== null ? "Amount in pieces" : "Amount in grams"}
            value={props.edit ?? amountText(entry)}
            onChange={(e) => props.onEdit(entry.id, e.target.value)}
            data-testid={`plan-entry-amount-${entry.id}`}
          />
          <span>{entry.pieces !== null ? "pieces" : "g"}</span>
          <button
            type="button"
            disabled={props.busy}
            onClick={() => props.onChange(props.date, entry)}
            data-testid={`plan-entry-change-${entry.id}`}
          >
            Change
          </button>
        </>
      )}
      <button
        type="button"
        disabled={props.busy}
        onClick={() => props.onRemove(props.date, entry)}
        data-testid={`plan-entry-remove-${entry.id}`}
      >
        Remove
      </button>
    </li>
  );
}

function MealBlock(props: { day: DaySheet; meal: Meal; view: PlanViewProps }) {
  const { day, meal, view } = props;
  const entries = day.meals.find((m) => m.meal === meal)?.entries ?? [];
  const values = view.state.forms[formKey(day.date, meal)] ?? EMPTY_FORM;
  return (
    <section data-testid={`plan-meal-${meal}`}>
      <h4>{MEAL_LABELS[meal]}</h4>
      <ul>
        {entries.map((entry) => (
          <EntryRow
            key={entry.id}
            date={day.date}
            entry={entry}
            edit={view.state.edits[entry.id]}
            busy={view.busy}
            onEdit={view.onEdit}
            onChange={view.onChange}
            onRemove={view.onRemove}
          />
        ))}
      </ul>
      <form
        noValidate
        data-testid={`plan-entry-form-${meal}`}
        onSubmit={(e) => {
          e.preventDefault();
          view.onSubmit(day.date, meal);
        }}
      >
        <select
          aria-label="Product or dish"
          value={values.subject}
          onChange={(e) => view.onForm(day.date, meal, { ...values, subject: e.target.value })}
          data-testid={`plan-entry-select-${meal}`}
        >
          <option value="">Choose a product or dish</option>
          <optgroup label="Products">
            {view.products.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Dishes">
            {view.dishes.map((d) => (
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
          onChange={(e) => view.onForm(day.date, meal, { ...values, grams: e.target.value })}
          data-testid={`plan-entry-grams-${meal}`}
        />
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label="Pieces"
          placeholder="Pieces"
          value={values.pieces}
          onChange={(e) => view.onForm(day.date, meal, { ...values, pieces: e.target.value })}
          data-testid={`plan-entry-pieces-${meal}`}
        />
        <button type="submit" disabled={view.busy} data-testid={`plan-entry-save-${meal}`}>
          Add
        </button>
      </form>
    </section>
  );
}

export function PlanView(props: PlanViewProps) {
  const { state } = props;
  return (
    <section data-testid="plan-screen">
      <h2>Daily plan</h2>
      <button type="button" onClick={props.onBack}>
        Back
      </button>
      {state.error ? (
        <p
          role="alert"
          data-testid="plan-error"
          data-code={state.error.code}
          data-reasons={state.error.reasons.join(",")}
        >
          {state.error.text}
        </p>
      ) : null}
      {state.days.map((day) => (
        <section key={day.date} data-testid={`plan-day-${day.date}`} data-date={day.date}>
          <h3>{day.date === state.today ? "Today" : "Next day"}</h3>
          <p data-testid="plan-day-date">{day.date}</p>
          {day.closed ? <p>This day is closed.</p> : null}
          {MEALS.map((meal) => (
            <MealBlock key={meal} day={day} meal={meal} view={props} />
          ))}
        </section>
      ))}
    </section>
  );
}
