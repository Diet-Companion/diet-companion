import { useEffect, useState } from "react";
import { LogView } from "./LogView";
import {
  changeAmount,
  confirmMeal,
  earlierDay,
  laterDay,
  openLog,
  removeEntry,
  setEdit,
  setForm,
  submitEntry,
  type LogDeps,
  type LogNext,
  type LogState,
} from "./logScreenLogic";
import type { Catalogs } from "./planScreenLogic";

export interface LogScreenProps {
  deps: LogDeps;
  onUnauthorized: () => void;
  onBack: () => void;
}

type Phase = { name: "loading" } | { name: "failed" } | { name: "ready"; state: LogState; catalogs: Catalogs };

// Reads today from the server each time it opens (ADR-016/C-003); every write is followed by a re-read.
export function LogScreen(props: LogScreenProps) {
  const { deps, onUnauthorized } = props;
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [busy, setBusy] = useState(false);

  async function load() {
    setPhase({ name: "loading" });
    const opened = await openLog(deps);
    if (opened.kind === "unauthorized") onUnauthorized();
    else if (opened.kind === "ok") setPhase({ name: "ready", state: opened.state, catalogs: opened.catalogs });
    else setPhase({ name: "failed" });
  }

  async function run(step: (state: LogState) => Promise<LogNext>) {
    if (phase.name !== "ready" || busy) return;
    setBusy(true);
    const next = await step(phase.state);
    setBusy(false);
    if (next.kind === "unauthorized") {
      onUnauthorized();
      return;
    }
    setPhase((p) => (p.name === "ready" ? { ...p, state: next.state } : p));
  }

  useEffect(() => {
    void load();
  }, []);

  if (phase.name === "ready") {
    return (
      <LogView
        state={phase.state}
        products={phase.catalogs.products}
        dishes={phase.catalogs.dishes}
        busy={busy}
        onForm={(meal, values) =>
          setPhase((p) => (p.name === "ready" ? { ...p, state: setForm(p.state, meal, values) } : p))
        }
        onSubmit={(meal) => void run((s) => submitEntry(deps, s, meal))}
        onEdit={(id, text) => setPhase((p) => (p.name === "ready" ? { ...p, state: setEdit(p.state, id, text) } : p))}
        onChange={(entry) => void run((s) => changeAmount(deps, s, entry))}
        onRemove={(entry) => void run((s) => removeEntry(deps, s, entry))}
        onConfirm={(meal) => void run((s) => confirmMeal(deps, s, meal))}
        onEarlier={() => void run((s) => earlierDay(deps, s))}
        onLater={() => void run((s) => laterDay(deps, s))}
        onBack={props.onBack}
      />
    );
  }
  if (phase.name === "failed") {
    return (
      <section data-testid="log-load-failed">
        <p role="alert">Your log could not be read. Try again.</p>
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
    <p role="status" data-testid="log-loading">
      Working on it...
    </p>
  );
}
