import type { Product } from "./api";
import { canClose } from "./closeLogic";
import type { Dish } from "./dishApi";
import { EntryFields } from "./EntryFields";
import type { LogEntry, LogMeal } from "./logApi";
import { canShowLater } from "./logLogic";
import { LogSplit } from "./LogSplit";
import { amountText, type LogState } from "./logScreenLogic";
import { MEALS, type Meal, type PlanSubject } from "./planApi";
import { EMPTY_FORM, MEAL_LABELS, formKey, markOf, type FormValues } from "./planLogic";
import { DayResultList, MealTotalsLine } from "./SheetResult";

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
  /** Dish split (REQ-014/AC-005, AC-010). */
  onSplitOpen?: (meal: Meal) => void;
  onSplitDish?: (meal: Meal, dishId: string) => void;
  onSplitLine?: (meal: Meal, position: number, values: { grams: string; pieces: string }) => void;
  onSplitSave?: (meal: Meal) => void;
  /** Close control (REQ-011/AC-001, AC-002): asks first; only confirm closes the day. */
  confirmingClose?: boolean;
  onClose?: () => void;
  onCloseConfirm?: () => void;
  onCloseCancel?: () => void;
}

function subjectText(s: PlanSubject): string {
  return `${s.name}${markOf(s)}`;
}

type RowProps = { entry: LogEntry; edit: string | undefined } & Pick<LogViewProps, "busy" | "onEdit" | "onChange" | "onRemove">;

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
          {entry.pieces !== null && entry.weightGrams !== null ? <span>{`(${entry.weightGrams} g)`}</span> : null}
          <button type="button" disabled={props.busy} onClick={() => props.onChange(entry)} data-testid={`log-entry-change-${entry.id}`}>
            Change
          </button>
        </>
      )}
      <button type="button" disabled={props.busy} onClick={() => props.onRemove(entry)} data-testid={`log-entry-remove-${entry.id}`}>
        Remove
      </button>
    </li>
  );
}

function MealBlock(props: { meal: Meal; logMeal: LogMeal | undefined; view: LogViewProps }) {
  const { meal, logMeal, view } = props;
  const date = view.state.day.date;
  const entries = logMeal?.entries ?? [];
  const key = formKey(date, meal);
  const values = view.state.forms[key] ?? EMPTY_FORM;
  return (
    <section data-testid={`log-meal-${meal}`}>
      <h4>{MEAL_LABELS[meal]}</h4>
      {logMeal?.hasPlan === true ? (
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
      <MealTotalsLine prefix="log" meal={meal} totals={logMeal?.totals} />
      <form
        noValidate
        data-testid={`log-entry-form-${meal}`}
        onSubmit={(e) => {
          e.preventDefault();
          view.onSubmit(meal);
        }}
      >
        <EntryFields
          prefix="log-entry"
          meal={meal}
          values={values}
          products={view.products}
          dishes={view.dishes}
          onChange={(next) => view.onForm(meal, next)}
        />
        <button type="submit" disabled={view.busy} data-testid={`log-entry-save-${meal}`}>
          Add
        </button>
      </form>
      <LogSplit
        meal={meal}
        form={view.state.splits?.[key]}
        dishes={view.dishes}
        busy={view.busy}
        onOpen={() => view.onSplitOpen?.(meal)}
        onDish={(dishId) => view.onSplitDish?.(meal, dishId)}
        onLine={(position, amounts) => view.onSplitLine?.(meal, position, amounts)}
        onSave={() => view.onSplitSave?.(meal)}
      />
    </section>
  );
}

// The close control: shown on an open day that is not after the server's today (REQ-011/AC-001).
function CloseControl(props: LogViewProps) {
  if (!canClose(props.state.day)) return null;
  if (!props.confirmingClose) {
    return (
      <button type="button" disabled={props.busy} onClick={() => props.onClose?.()} data-testid="log-close">
        Close this day
      </button>
    );
  }
  return (
    <div role="group" aria-label="Close this day">
      <p>Close this day? A closed day cannot be reopened.</p>
      <button type="button" disabled={props.busy} onClick={() => props.onCloseConfirm?.()} data-testid="log-close-confirm">
        Yes, close it
      </button>
      <button type="button" disabled={props.busy} onClick={() => props.onCloseCancel?.()} data-testid="log-close-cancel">
        Cancel
      </button>
    </div>
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
        <p role="alert" data-testid="log-error" data-code={state.error.code} data-reasons={state.error.reasons.join(",")}>
          {state.error.text}
        </p>
      ) : null}
      <h3>{day.date === state.today ? "Today" : "Earlier day"}</h3>
      <p data-testid="log-day-date">{day.date}</p>
      <button type="button" disabled={props.busy} onClick={props.onEarlier} data-testid="log-earlier">
        Earlier day
      </button>
      {canShowLater(day.date, state.today) ? (
        <button type="button" disabled={props.busy} onClick={props.onLater} data-testid="log-later">
          Later day
        </button>
      ) : null}
      {day.closed ? <p data-testid="log-closed-mark">This day is closed.</p> : null}
      <CloseControl {...props} />
      <DayResultList prefix="log" result={day.result} />
      {MEALS.map((meal) => (
        <MealBlock key={meal} meal={meal} logMeal={day.meals.find((m) => m.meal === meal)} view={props} />
      ))}
    </section>
  );
}
