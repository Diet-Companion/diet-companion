import { useEffect, useState } from "react";
import { TargetsEditView } from "./TargetsEditView";
import { applyOutcome, loadEdit, sendRange, setEditField, type EditState } from "./targetsEdit";
import type { Nutrient, TargetsApi } from "./targetsApi";

export interface TargetsScreenProps {
  api: TargetsApi;
  onUnauthorized: () => void;
  onBack: () => void;
}

type Phase = { name: "loading" } | { name: "failed" } | { name: "edit"; state: EditState };

// Reads the ranges each time it opens, so as_of and every effective_from come from the server.
export function TargetsScreen(props: TargetsScreenProps) {
  const { api, onUnauthorized } = props;
  const [phase, setPhase] = useState<Phase>({ name: "loading" });

  async function load() {
    setPhase({ name: "loading" });
    const result = await loadEdit(api);
    if (result.kind === "unauthorized") {
      onUnauthorized();
    } else if (result.kind === "ok") {
      setPhase({ name: "edit", state: result.state });
    } else {
      setPhase({ name: "failed" });
    }
  }

  async function save(nutrient: Nutrient) {
    if (phase.name !== "edit") return;
    const outcome = await sendRange(api, nutrient, phase.state.fields[nutrient]);
    if (outcome.kind === "unauthorized") {
      onUnauthorized();
      return;
    }
    setPhase((p) => (p.name === "edit" ? { name: "edit", state: applyOutcome(p.state, nutrient, outcome) } : p));
  }

  useEffect(() => {
    void load();
  }, []);

  if (phase.name === "edit") {
    return (
      <TargetsEditView
        state={phase.state}
        onChange={(n, which, value) =>
          setPhase((p) => (p.name === "edit" ? { name: "edit", state: setEditField(p.state, n, which, value) } : p))
        }
        onSave={(n) => void save(n)}
        onBack={props.onBack}
      />
    );
  }
  if (phase.name === "failed") {
    return (
      <section data-testid="targets-load-failed">
        <p role="alert">Your targets could not be read. Try again.</p>
        <button type="button" onClick={() => void load()}>
          Try again
        </button>
        <button type="button" onClick={props.onBack}>
          Back
        </button>
      </section>
    );
  }
  return (
    <p role="status" data-testid="targets-loading">
      Working on it...
    </p>
  );
}
