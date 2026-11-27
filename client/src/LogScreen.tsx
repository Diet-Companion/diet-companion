import { useEffect, useState } from "react";
import { closeStep, type CloseAction } from "./closeLogic";
import { LogView } from "./LogView";
import {
  changeAmount,
  chooseSplitDish,
  confirmMeal,
  earlierDay,
  laterDay,
  openLog,
  openSplit,
  removeEntry,
  setEdit,
  setForm,
  setSplitLine,
  submitEntry,
  submitSplit,
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
  // True while the close confirmation is asked. Only its confirm button calls closeDay (REQ-016/AC-003).
  const [confirming, setConfirming] = useState(false);

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

  async function close(action: CloseAction) {
    if (phase.name !== "ready" || busy) return;
    setBusy(true);
    const result = await closeStep(deps.log, phase.state, confirming, action);
    setBusy(false);
    setConfirming(result.confirming);
    if (result.next.kind === "unauthorized") {
      onUnauthorized();
      return;
    }
    const next = result.next;
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
        confirmingClose={confirming}
        onClose={() => void close("ask")}
        onCloseConfirm={() => void close("confirm")}
        onCloseCancel={() => void close("cancel")}
        onForm={(meal, values) =>
          setPhase((p) => (p.name === "ready" ? { ...p, state: setForm(p.state, meal, values) } : p))
        }
        onSubmit={(meal) => void run((s) => submitEntry(deps, s, meal))}
        onEdit={(id, text) => setPhase((p) => (p.name === "ready" ? { ...p, state: setEdit(p.state, id, text) } : p))}
        onChange={(entry) => void run((s) => changeAmount(deps, s, entry))}
        onRemove={(entry) => void run((s) => removeEntry(deps, s, entry))}
        onConfirm={(meal) => void run((s) => confirmMeal(deps, s, meal))}
        onEarlier={() => {
          setConfirming(false);
          void run((s) => earlierDay(deps, s));
        }}
        onLater={() => {
          setConfirming(false);
          void run((s) => laterDay(deps, s));
        }}
        onBack={props.onBack}
        onSplitOpen={(meal) =>
          setPhase((p) => (p.name === "ready" ? { ...p, state: openSplit(p.state, meal) } : p))
        }
        onSplitDish={(meal, dishId) =>
          setPhase((p) =>
            p.name === "ready"
              ? { ...p, state: chooseSplitDish(p.state, meal, p.catalogs.dishes.find((d) => d.id === dishId)) }
              : p,
          )
        }
        onSplitLine={(meal, position, values) =>
          setPhase((p) => (p.name === "ready" ? { ...p, state: setSplitLine(p.state, meal, position, values) } : p))
        }
        onSplitSave={(meal) => void run((s) => submitSplit(deps, s, meal))}
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
