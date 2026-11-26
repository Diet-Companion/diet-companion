import type { FormEvent } from "react";
import { TARGET_ERROR_TEXT, TARGET_LABELS, type SetupState } from "./targets";
import { NUTRIENTS, type Nutrient } from "./targetsApi";

export interface TargetsSetupViewProps {
  state: SetupState;
  onChange: (nutrient: Nutrient, which: "min" | "max", value: string) => void;
  onSave: (nutrient: Nutrient) => void;
}

// Controlled, so a refused save keeps the fields as typed (REQ-009/AC-001 setup; errors from IF-001@1.4.0#setTargetRange).
export function TargetsSetupView(props: TargetsSetupViewProps) {
  const { state } = props;
  return (
    <section data-testid="targets-setup">
      <h2>Set your daily targets</h2>
      <p>Enter a minimum and a maximum for each. They apply from today. Nothing else opens until all three are saved.</p>
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
            ) : state.saved[n] ? (
              <p role="status">Saved.</p>
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
