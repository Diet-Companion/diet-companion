import { useEffect, useState } from "react";
import type { ListResult } from "./api";
import type { DishListResult } from "./dishApi";
import type { DaySheet, Meal, PlanApi, PlanEntry, PlanError } from "./planApi";
import { EMPTY_FORM, entryInput, formKey, nextDate, writeOutcome, type FormValues, type WriteOutcome } from "./planLogic";
import { PlanView, type Choice } from "./PlanView";
import type { TargetsApi } from "./targetsApi";

export interface PlanScreenProps {
  api: PlanApi;
  targetsApi: TargetsApi;
  listProducts: () => Promise<ListResult>;
  listDishes: () => Promise<DishListResult>;
  onUnauthorized: () => void;
  onBack: () => void;
}

// Today comes from the server: the first read asks for the server date through getTargetRanges (IF-001 has no
// date-free day read); every later read uses the today of the day responses (ADR-016/C-003).
export function PlanScreen(props: PlanScreenProps) {
  const { api, onUnauthorized } = props;
  const [phase, setPhase] = useState<"loading" | "failed" | "ready">("loading");
  const [sheets, setSheets] = useState<DaySheet[]>([]);
  const [products, setProducts] = useState<Choice[]>([]);
  const [dishes, setDishes] = useState<Choice[]>([]);
  const [forms, setForms] = useState<Record<string, FormValues>>({});
  const [error, setError] = useState<PlanError | null>(null);

  async function loadDays(today: string) {
    const next = nextDate(today);
    const results = await Promise.all((next ? [today, next] : [today]).map((d) => api.getDayPlan(d)));
    const loaded: DaySheet[] = [];
    for (const r of results) {
      if (r.kind === "unauthorized") {
        onUnauthorized();
        return;
      }
      if (r.kind !== "ok") {
        setPhase("failed");
        return;
      }
      loaded.push(r.sheet);
    }
    setSheets(loaded);
    setPhase("ready");
  }

  async function load() {
    setPhase("loading");
    const [ranges, p, d] = await Promise.all([props.targetsApi.getTargetRanges(), props.listProducts(), props.listDishes()]);
    if (ranges.kind === "unauthorized" || p.kind === "unauthorized" || d.kind === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (ranges.kind !== "ok" || p.kind !== "ok" || d.kind !== "ok") {
      setPhase("failed");
      return;
    }
    setProducts(p.products);
    setDishes(d.dishes);
    await loadDays(ranges.ranges.as_of);
  }

  async function settle(outcome: WriteOutcome, done: () => void) {
    if (outcome.kind === "login") {
      onUnauthorized();
    } else if (outcome.kind === "stay") {
      setError(outcome.error);
    } else {
      setError(null);
      done();
      const today = sheets[0]?.today;
      if (today) await loadDays(today);
    }
  }

  async function save(date: string, meal: Meal) {
    const key = formKey(date, meal);
    const form = forms[key] ?? EMPTY_FORM;
    const outcome = writeOutcome(await api.addPlanEntry(date, entryInput(meal, form)));
    await settle(outcome, () => setForms((f) => ({ ...f, [key]: EMPTY_FORM })));
  }

  async function remove(date: string, entry: PlanEntry) {
    await settle(writeOutcome(await api.removePlanEntry(date, entry.id)), () => undefined);
  }

  useEffect(() => {
    void load();
  }, []);

  if (phase === "ready") {
    return (
      <PlanView
        sheets={sheets}
        products={products}
        dishes={dishes}
        forms={forms}
        error={error}
        onForm={(key, patch) => setForms((f) => ({ ...f, [key]: { ...(f[key] ?? EMPTY_FORM), ...patch } }))}
        onSave={(date, meal) => void save(date, meal)}
        onRemove={(date, entry) => void remove(date, entry)}
        onBack={props.onBack}
      />
    );
  }
  if (phase === "failed") {
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
