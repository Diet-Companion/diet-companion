// Close control and close reminder logic (REQ-011, REQ-016). Pure over injected APIs.
// Today comes from the day response (ADR-016/C-003). Open days are taken as the server sends them.

import type { LogCloseApi } from "./logApi";
import { logErrorText } from "./logLogic";
import type { LogNext, LogState } from "./logScreenLogic";
import type { OpenDaysApi } from "./planApi";

/** A day can be closed when it is not closed and not after today. Dates are YYYY-MM-DD, so text order is date order. */
export function canClose(state: LogState): boolean {
  return !state.day.closed && state.day.date <= state.today;
}

export type CloseAction = "ask" | "cancel" | "confirm";

export interface CloseStepResult {
  /** Whether the confirmation prompt is shown after the step. */
  confirming: boolean;
  next: LogNext;
}

/**
 * One step of the close control. Only "confirm" after "ask" calls closeDay; cancel calls nothing and the day
 * stays open (REQ-011/AC-002). A refusal keeps the shown day and shows its code.
 * log is any API object; closeDay is read from it when present.
 */
export async function closeStep(
  log: object,
  state: LogState,
  confirming: boolean,
  action: CloseAction,
): Promise<CloseStepResult> {
  const stay = (c: boolean): CloseStepResult => ({ confirming: c, next: { kind: "state", state } });
  if (action === "cancel" || !canClose(state)) return stay(false);
  if (action === "ask") return stay(true);
  if (!confirming) return stay(false);
  const close = (log as Partial<LogCloseApi>).closeDay?.bind(log);
  const failed = (message: string | null): CloseStepResult => ({
    confirming: false,
    next: {
      kind: "state",
      state: { ...state, error: { code: "failed", reasons: [], text: logErrorText({ code: "failed", reasons: [], message }) } },
    },
  });
  if (!close) return failed(null);
  const r = await close(state.day.date);
  if (r.kind === "unauthorized") return { confirming: false, next: { kind: "unauthorized" } };
  if (r.kind === "ok") {
    return { confirming: false, next: { kind: "state", state: { ...state, today: r.day.today, day: r.day, error: null } } };
  }
  if (r.kind === "refused") {
    const { code, reasons } = r.error;
    return { confirming: false, next: { kind: "state", state: { ...state, error: { code, reasons, text: logErrorText(r.error) } } } };
  }
  return failed(r.message);
}

/** Open days to remind about, by the plan day they were asked for. A day with none, or a failed read, has no entry. */
export type Reminders = Record<string, string[]>;

/** Asks getOpenDays with before set to each shown day (REQ-011/AC-004, AC-012, AC-013). Never blocks planning. */
export async function readReminders(api: Partial<OpenDaysApi>, dates: string[]): Promise<Reminders> {
  const out: Reminders = {};
  const get = api.getOpenDays?.bind(api);
  if (!get) return out;
  for (const date of dates) {
    const r = await get(date);
    if (r.kind === "ok" && r.open.days.length > 0) out[date] = r.open.days;
  }
  return out;
}
