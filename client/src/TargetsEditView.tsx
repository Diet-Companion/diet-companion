import type { FormEvent } from "react";
import { TARGET_ERROR_TEXT, TARGET_LABELS } from "./targets";
import { describeRange, type EditState } from "./targetsEdit";
import { NUTRIENTS, type Nutrient } from "./targetsApi";

export interface TargetsEditViewProps {
  state: EditState;
  onChange: (nutrient: Nutrient, which: "min" | "max", value: string) => void;
  onSave: (nutrient: Nutrient) => void;
  onBack: () => void;
}

// Controlled, so a refused change keeps the fields as typed. One range per nutrient, nothing per day.
export function TargetsEditView(props: TargetsEditViewProps) {
  const { state } = props;
  return (
    <section data-testid="targets-edit">
      <h2>Your daily targets</h2>
      <p data-testid="targets-as-of">{`Today: ${state.asOf}`}</p>
      <p>A change applies from today. Earlier days keep the range they had.</p>
      <button type="button" data-testid="targets-back" onClick={props.onBack}>
        Back
      </button>
      {NUTRIENTS.map((n) => {
        const error = state.errors[n];
        return (
          <form
            key={n}
            noValidate
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              props.onSave(n);
            }}
          >
            <h3>{TARGET_LABELS[n]}</h3>
            <p data-testid={`target-current-${n}`}>{describeRange(state.ranges[n])}</p>
            <div className="field">
              <label htmlFor={`target-min-${n}`}>Minimum</label>
              <input
                id={`target-min-${n}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={state.fields[n].min}
                onChange={(e) => props.onChange(n, "min", e.target.value)}
                aria-invalid={error ? true : undefined}
                data-testid={`target-min-${n}`}
              />
            </div>
            <div className="field">
              <label htmlFor={`target-max-${n}`}>Maximum</label>
              <input
                id={`target-max-${n}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={state.fields[n].max}
                onChange={(e) => props.onChange(n, "max", e.target.value)}
                aria-invalid={error ? true : undefined}
                data-testid={`target-max-${n}`}
              />
            </div>
            {error ? (
              <p role="alert" data-testid={`target-error-${n}`} data-code={error}>
                {TARGET_ERROR_TEXT[error]}
              </p>
            ) : null}
            <button type="submit" data-testid={`target-save-${n}`}>
              Save
            </button>
          </form>
        );
      })}
    </section>
  );
}
