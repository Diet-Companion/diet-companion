import { useEffect, useState } from "react";
import { readReminders, type Reminders } from "./closeLogic";
import { PlanView } from "./PlanView";
import type { OpenDaysApi, PlanApi } from "./planApi";
import {
  changeAmount,
  openPlan,
  removeEntry,
  setEdit,
  setForm,
  submitEntry,
  type Catalogs,
  type Next,
  type PlanDeps,
  type PlanState,
} from "./planScreenLogic";

export interface PlanScreenProps {
  /** plan may also carry getOpenDays for the close reminder (REQ-011/AC-004); without it no reminder shows. */
  deps: PlanDeps & { plan: PlanApi & Partial<OpenDaysApi> };
  onUnauthorized: () => void;
  onBack: () => void;
}

type Phase = { name: "loading" } | { name: "failed" } | { name: "ready"; state: PlanState; catalogs: Catalogs };

// Reads today from the server each time it opens (ADR-016/C-003); every write is followed by a re-read.
export function PlanScreen(props: PlanScreenProps) {
  const { deps, onUnauthorized } = props;
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [reminders, setReminders] = useState<Reminders>({});

  async function load() {
    setPhase({ name: "loading" });
    const opened = await openPlan(deps);
    if (opened.kind === "unauthorized") onUnauthorized();
    else if (opened.kind === "ok") setPhase({ name: "ready", state: opened.state, catalogs: opened.catalogs });
    else setPhase({ name: "failed" });
  }

  async function run(step: (state: PlanState) => Promise<Next>) {
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

  // The reminder of each shown day: getOpenDays with before set to that day. It never blocks the screen.
  const shownDays = phase.name === "ready" ? phase.state.days.map((d) => d.date).join(",") : "";
  useEffect(() => {
    if (shownDays === "") return;
    let current = true;
    void readReminders(deps.plan, shownDays.split(",")).then((r) => {
      if (current) setReminders(r);
    });
    return () => {
      current = false;
    };
  }, [shownDays]);

  if (phase.name === "ready") {
    return (
      <PlanView
        state={phase.state}
        products={phase.catalogs.products}
        dishes={phase.catalogs.dishes}
        busy={busy}
        reminders={reminders}
        onForm={(date, meal, values) =>
          setPhase((p) => (p.name === "ready" ? { ...p, state: setForm(p.state, date, meal, values) } : p))
        }
        onSubmit={(date, meal) => void run((s) => submitEntry(deps, s, date, meal))}
        onEdit={(id, text) => setPhase((p) => (p.name === "ready" ? { ...p, state: setEdit(p.state, id, text) } : p))}
        onChange={(date, entry) => void run((s) => changeAmount(deps, s, date, entry))}
        onRemove={(date, entry) => void run((s) => removeEntry(deps, s, date, entry))}
        onBack={props.onBack}
      />
    );
  }
  if (phase.name === "failed") {
    return (
      <section data-testid="plan-load-failed">
        <p role="alert">Your plan could not be read. Try again.</p>
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
    <p role="status" data-testid="plan-loading">
      Working on it...
    </p>
  );
}
