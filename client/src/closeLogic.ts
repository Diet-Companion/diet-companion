// Closing a day and the close reminder (REQ-011, REQ-016). Pure over injected deps.
// Today comes from the day response (ADR-016/C-003); the device clock is never read.
// Only confirmClose calls closeDay; nothing closes a day by itself (REQ-016/AC-003).

import type { LogDay } from "./logApi";
import { logErrorText } from "./logLogic";
import type { LogDeps, LogNext, LogState } from "./logScreenLogic";
import type { PlanOpenApi } from "./planApi";
import type { ShownError } from "./planScreenLogic";

/** A day can be closed when it is open and not after the server's today. Dates are YYYY-MM-DD. */
export function canClose(day: LogDay): boolean {
  return !day.closed && day.date <= day.today;
}

const CLOSE_TEXT: Record<string, string> = {
  "close.day_out_of_range": "This day cannot be closed. Nothing was changed.",
  "day.closed": "This day is already closed. Nothing was changed.",
};

/**
 * Closes the shown day on the Owner's confirmation. Success shows the returned sheet;
 * a refusal keeps the shown day and says why.
 */
export async function confirmClose(deps: LogDeps, state: LogState): Promise<LogNext> {
  const close = deps.log.closeDay?.bind(deps.log);
  if (!close || !canClose(state.day)) return { kind: "state", state };
  const r = await close(state.day.date);
  if (r.kind === "unauthorized") return { kind: "unauthorized" };
  if (r.kind === "ok") return { kind: "state", state: { ...state, today: r.day.today, day: r.day, error: null } };
  const error: ShownError =
    r.kind === "refused"
      ? {
          code: r.error.code,
          reasons: r.error.reasons,
          text: CLOSE_TEXT[r.error.code] ?? logErrorText(r.error),
        }
      : { code: "failed", reasons: [], text: logErrorText({ code: "failed", reasons: [], message: r.message }) };
  return { kind: "state", state: { ...state, error } };
}

/**
 * The open days before each date, as the server sends them (oldest first), by date.
 * A date with none, a failed read or a missing operation has no entry: no reminder, and planning is never blocked.
 */
export async function readReminders(plan: Partial<PlanOpenApi>, dates: string[]): Promise<Record<string, string[]>> {
  const get = plan.getOpenDays?.bind(plan);
  const out: Record<string, string[]> = {};
  if (!get) return out;
  await Promise.all(
    dates.map(async (date) => {
      try {
        const r = await get(date);
        if (r.kind === "ok" && r.days.length > 0) out[date] = r.days;
      } catch {
        // A failed read shows no reminder.
      }
    }),
  );
  return out;
}
