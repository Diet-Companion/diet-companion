import type { Product } from "./api";
import type { Dish } from "./dishApi";
import { EntryFields } from "./EntryFields";
import type { LogEntry } from "./logApi";
import { canShowLater } from "./logLogic";
import { amountText, type LogState } from "./logScreenLogic";
import { MEALS, type Meal, type PlanSubject } from "./planApi";
import { EMPTY_FORM, MEAL_LABELS, formKey, markOf, type FormValues } from "./planLogic";

export interface LogViewProps {
  state: LogState;
  products: Product[];
  dishes: Dish[];
  busy: boolean;
  onForm: (meal: Meal, values: FormValues) => void;
  onSubmit: (meal: Meal) => void;
  onEdit: (entryId: string, text: string) => void;
  onChange: (entry: LogEntry) => void;
  onRemove: (entry: LogEntry) => void;
  onConfirm: (meal: Meal) => void;
  onEarlier: () => void;
  onLater: () => void;
  onBack: () => void;
}

function subjectText(s: PlanSubject): string {
  return `${s.name}${markOf(s)}`;
}

type RowProps = { entry: LogEntry; edit: string | undefined } & Pick<LogViewProps, "busy" | "onEdit" | "onChange" | "onRemove">;

// A pieces entry shows the weight and the product's values as the response gives them (REQ-014/AC-008).
function PiecesInfo(props: { entry: LogEntry }) {
  const { entry } = props;
  if (entry.pieces === null) return null;
  return (
    <span data-testid={`log-entry-weight-${entry.id}`}>
      {entry.weightGrams !== null ? `${entry.weightGrams} g` : ""}
      {entry.caloriesPer100 !== null ? ` (${entry.caloriesPer100} kcal per 100 g)` : ""}
    </span>
  );
}

function EntryRow(props: RowProps) {
  const { entry } = props;
  const subject = entry.dish ?? entry.product;
  return (
    <li data-testid={`log-entry-row-${entry.id}`}>
      <span>{subject ? subjectText(subject) : ""}</span>
      {entry.dish ? (
        <span data-testid={`log-entry-amount-${entry.id}`}>Whole dish</span>
      ) : (
        <>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={entry.pieces !== null ? "Amount in pieces" : "Amount in grams"}
            value={props.edit ?? amountText(entry)}
            onChange={(e) => props.onEdit(entry.id, e.target.value)}
            data-testid={`log-entry-amount-${entry.id}`}
          />
          <span>{entry.pieces !== null ? "pieces" : "g"}</span>
          <PiecesInfo entry={entry} />
          <button
            type="button"
            disabled={props.busy}
            onClick={() => props.onChange(entry)}
            data-testid={`log-entry-change-${entry.id}`}
          >
            Change
          </button>
        </>
      )}
      <button
        type="button"
        disabled={props.busy}
        onClick={() => props.onRemove(entry)}
        data-testid={`log-entry-remove-${entry.id}`}
      >
        Remove
      </button>
    </li>
  );
}

function MealBlock(props: { meal: Meal; view: LogViewProps }) {
  const { meal, view } = props;
  const day = view.state.day;
  const sheet = day.meals.find((m) => m.meal === meal);
  const entries = sheet?.entries ?? [];
  const values = view.state.forms[formKey(day.date, meal)] ?? EMPTY_FORM;
  return (
    <section data-testid={`log-meal-${meal}`}>
      <h4>{MEAL_LABELS[meal]}</h4>
      {sheet?.hasPlan === true ? (
        <button type="button" disabled={view.busy} onClick={() => view.onConfirm(meal)} data-testid={`log-confirm-${meal}`}>
          Confirm as planned
        </button>
      ) : null}
      <ul>
        {entries.map((entry) => (
          <EntryRow
            key={entry.id}
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
        data-testid={`log-entry-form-${meal}`}
        onSubmit={(e) => {
          e.preventDefault();
          view.onSubmit(meal);
        }}
      >
        <EntryFields
          values={values}
          products={view.products}
          dishes={view.dishes}
          testIds={{
            select: `log-entry-select-${meal}`,
            grams: `log-entry-grams-${meal}`,
            pieces: `log-entry-pieces-${meal}`,
          }}
          onValues={(next) => view.onForm(meal, next)}
        />
        <button type="submit" disabled={view.busy} data-testid={`log-entry-save-${meal}`}>
          Add
        </button>
      </form>
    </section>
  );
}

export function LogView(props: LogViewProps) {
  const { state } = props;
  const { day } = state;
  return (
    <section data-testid="log-screen">
      <h2>Meal log</h2>
      <button type="button" onClick={props.onBack}>
        Back
      </button>
      {state.error ? (
        <p
          role="alert"
          data-testid="log-error"
          data-code={state.error.code}
          data-reasons={state.error.reasons.join(",")}
        >
          {state.error.text}
        </p>
      ) : null}
      <div data-date={day.date}>
        <button type="button" disabled={props.busy} onClick={props.onEarlier} data-testid="log-day-earlier">
          Earlier day
        </button>
        <h3>{day.date === state.today ? "Today" : "Earlier day"}</h3>
        <p data-testid="log-day-date">{day.date}</p>
        {canShowLater(day.date, state.today) ? (
          <button type="button" disabled={props.busy} onClick={props.onLater} data-testid="log-day-later">
            Later day
          </button>
        ) : null}
      </div>
      {day.closed ? <p>This day is closed.</p> : null}
      {MEALS.map((meal) => (
        <MealBlock key={meal} meal={meal} view={props} />
      ))}
    </section>
  );
}
