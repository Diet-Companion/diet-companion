import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { firstDayOfUse, previousDay, type DayCloser, type DayRange } from "./day-close.js";
import { buildLogSheet } from "./log.js";
import { nextDay, requireOwner, sendError, type PlanRouteDeps } from "./plan.js";
import { DayClosedError } from "./plan-store.js";
import { TARGET_NUTRIENTS, type TargetStore } from "./target-store.js";
import { isCalendarDate, rangesInForce } from "./targets.js";
import { todayIn } from "./today.js";

/** Dependencies of the closing routes (CMP-002, IF-001@1.6.0). */
export interface CloseRouteDeps extends PlanRouteDeps {
  closer: DayCloser;
  targets: TargetStore;
}

/** Page size of listDays (IF-001@1.6.0, A-044). */
const DEFAULT_LIMIT = 31;
const MAX_LIMIT = 100;

/** The limit query value as a number, or undefined when it is not an integer from 1 to 100. */
function parseLimit(raw: unknown): number | undefined {
  if (raw === undefined) return DEFAULT_LIMIT;
  if (typeof raw !== "string" || !/^\d{1,3}$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= 1 && value <= MAX_LIMIT ? value : undefined;
}

/**
 * The ranges in force on a date, through the one shared function (ADR-015/C-003). A nutrient that has no range
 * gets no row (A-045).
 */
export async function rangesToStore(targets: TargetStore, date: string): Promise<DayRange[]> {
  const found = await rangesInForce(targets, date);
  const ranges: DayRange[] = [];
  for (const nutrient of TARGET_NUTRIENTS) {
    const range = found[nutrient];
    if (range) ranges.push({ nutrient, minimum: range.minimum, maximum: range.maximum });
  }
  return ranges;
}

export function registerCloseRoutes(app: FastifyInstance, deps: CloseRouteDeps): void {
  const clock = deps.clock ?? ((): Date => new Date());
  const unauthorised = (request: FastifyRequest, reply: FastifyReply): FastifyReply =>
    sendError(request, reply, 401, "auth.required", "No valid Owner session.");
  const badRequest = (request: FastifyRequest, reply: FastifyReply, message: string): FastifyReply =>
    sendError(request, reply, 400, "request.invalid", message);

  // IF-001@1.6.0 closeDay. Check order: session, date, close window, day open. Never automatic, never reopened.
  app.post("/days/:date/close", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return unauthorised(request, reply);
    const date = (request.params as { date: string }).date;
    if (!isCalendarDate(date)) return badRequest(request, reply, "The date is not a valid calendar date.");
    const now = clock();
    const today = todayIn(now, deps.timeZone);
    const first = await firstDayOfUse(deps.targets, deps.closer, today);
    if (date > today || date < first) {
      return sendError(
        request,
        reply,
        422,
        "close.day_out_of_range",
        "Only days from the first day of use through today can be closed.",
      );
    }
    try {
      await deps.closer.closeDay(date, now, () => rangesToStore(deps.targets, date));
    } catch (error) {
      if (error instanceof DayClosedError) {
        return sendError(request, reply, 409, "day.closed", "The day is closed and never changes.");
      }
      throw error;
    }
    return reply.code(200).send(await buildLogSheet(deps, date, today));
  });

  // IF-001@1.6.0 getOpenDays: the open days before a date, oldest first, from the first day of use, not after today.
  // It only reports: plan writes are never blocked by an open day (R-013).
  app.get("/days/open", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return unauthorised(request, reply);
    const before = (request.query as { before?: unknown }).before;
    if (typeof before !== "string" || !isCalendarDate(before)) {
      return badRequest(request, reply, "The before date is missing or not a valid calendar date.");
    }
    const today = todayIn(clock(), deps.timeZone);
    const first = await firstDayOfUse(deps.targets, deps.closer, today);
    const dayBefore = previousDay(before);
    const last = dayBefore < today ? dayBefore : today;
    const days: string[] = [];
    if (first <= last) {
      const closed = new Set(await deps.closer.closedDays(first, nextDay(last)));
      for (let day = first; day <= last; day = nextDay(day)) {
        if (!closed.has(day)) days.push(day);
      }
    }
    return reply.code(200).send({ first_day_of_use: first, before, days });
  });

  // IF-001@1.6.0 listDays (REQ-016/AC-001, AC-004, AC-005): days newest first from the day before `before`
  // (default tomorrow) back to the first day of use, open, closed and empty days alike. One closedDays read per page.
  app.get("/days", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return unauthorised(request, reply);
    const query = request.query as { before?: unknown; limit?: unknown };
    const today = todayIn(clock(), deps.timeZone);
    const tomorrow = nextDay(today);
    let before = tomorrow;
    if (query.before !== undefined) {
      if (typeof query.before !== "string" || !isCalendarDate(query.before)) {
        return badRequest(request, reply, "The before date is not a valid calendar date.");
      }
      if (query.before > tomorrow) return badRequest(request, reply, "The before date is after tomorrow.");
      before = query.before;
    }
    const limit = parseLimit(query.limit);
    if (limit === undefined) return badRequest(request, reply, "The limit must be a whole number from 1 to 100.");

    const first = await firstDayOfUse(deps.targets, deps.closer, today);
    const last = previousDay(before);
    if (last < first) return reply.code(200).send({ first_day_of_use: first, items: [], next_before: null });

    let oldest = last;
    for (let count = 1; count < limit && oldest > first; count++) oldest = previousDay(oldest);

    const closed = new Set(await deps.closer.closedDays(oldest, before));
    const items: { date: string; state: "open" | "closed"; open_past: boolean; closed_at: string | null }[] = [];
    for (let day = last; day >= oldest; day = previousDay(day)) {
      if (closed.has(day)) {
        const at = await deps.closer.closedAt(day);
        items.push({ date: day, state: "closed", open_past: false, closed_at: at ? at.toISOString() : null });
      } else {
        items.push({ date: day, state: "open", open_past: day < today, closed_at: null });
      }
    }
    return reply.code(200).send({ first_day_of_use: first, items, next_before: oldest > first ? oldest : null });
  });
}
