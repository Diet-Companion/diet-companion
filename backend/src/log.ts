import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isDishSelectable } from "./dish-store.js";
import { DayClosedError, MEALS, isMeal, type Meal, type PlanTx, type StoredEntry } from "./plan-store.js";
import {
  CHANGE_KEYS,
  EntryMissing,
  EntryRefused,
  NEW_ENTRY_KEYS,
  addEntryWork,
  asObject,
  changeEntryWork,
  readAmount,
  requireOwner,
  sendError,
  toEntryResponse,
  type Amount,
  type PlanRouteDeps,
} from "./plan.js";
import { isCalendarDate } from "./targets.js";
import { todayIn } from "./today.js";

class PlanEmpty extends Error {}
class LogNotEmpty extends Error {}

/** addLogDishProducts refused the dish or some lines; thrown inside the transaction so nothing is saved. */
class DishLinesRefused extends Error {
  constructor(
    readonly reasons: string[],
    readonly lines: { index: number; reason: string }[],
  ) {
    super("dish lines refused");
  }
}

/** One amount override of addLogDishProducts: the dish line position and its raw amount fields. */
interface LineOverride {
  position: number;
  amount: Record<string, unknown>;
}

const OVERRIDE_KEYS: readonly string[] = ["position", "grams", "pieces"];
const DISH_PRODUCTS_KEYS: readonly string[] = ["meal", "dish_id", "lines"];

/** The overrides of a request body, or undefined when the shape is wrong (request.invalid). */
function readOverrides(value: unknown): LineOverride[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const overrides: LineOverride[] = [];
  for (const raw of value as unknown[]) {
    const item = asObject(raw);
    if (!item || raw === null || raw === undefined) return undefined;
    if (Object.keys(item).some((key) => !OVERRIDE_KEYS.includes(key))) return undefined;
    const position = item.position;
    if (typeof position !== "number" || !Number.isInteger(position) || position < 0) return undefined;
    if (overrides.some((o) => o.position === position)) return undefined;
    overrides.push({ position, amount: item });
  }
  return overrides;
}

/** The checks and inserts of addLogDishProducts, inside the day-row lock (ADR-018/C-001). */
async function dishProductsWork(
  deps: PlanRouteDeps,
  dishId: string,
  meal: Meal,
  overrides: LineOverride[],
  tx: PlanTx,
): Promise<StoredEntry[]> {
  const found = await deps.dishes.get(dishId);
  if (!found) throw new DishLinesRefused(["dish_not_found"], []);
  if (!isDishSelectable(found.state)) throw new DishLinesRefused(["dish_not_selectable"], []);
  const lines = [...found.dish.lines].sort((a, b) => a.position - b.position);
  const amounts = new Map<number, Amount>();
  const refused: { index: number; reason: string }[] = [];
  for (const [index, override] of overrides.entries()) {
    const line = lines.find((l) => l.position === override.position);
    if (!line) {
      refused.push({ index, reason: "line_unknown" });
      continue;
    }
    const amount = readAmount(override.amount);
    if (typeof amount === "string") {
      refused.push({ index, reason: "amount_invalid" });
      continue;
    }
    if (amount.pieces !== null) {
      const product = await deps.products.get(line.product_id);
      if (!((product?.product.piece_weight ?? 0) > 0)) {
        refused.push({ index, reason: "piece_without_weight" });
        continue;
      }
    }
    amounts.set(line.position, amount);
  }
  if (refused.length > 0) throw new DishLinesRefused([], refused);
  const saved: StoredEntry[] = [];
  for (const line of lines) {
    const amount = amounts.get(line.position) ?? { grams: line.grams, pieces: line.pieces };
    saved.push(
      await tx.add({
        meal,
        product_id: line.product_id,
        dish_id: null,
        grams: amount.grams,
        pieces: amount.pieces,
        from_dish_id: found.dish.id,
      }),
    );
  }
  return saved;
}

/** A-035: the log takes any day up to and including today. Dates are YYYY-MM-DD, so strings compare in order. */
export function isLoggable(date: string, today: string): boolean {
  return date <= today;
}

/** The routes of the meal log (CMP-002, IF-001@1.5.0). Log rows are kind = 'log' of the plan store (ADR-017/C-001). */
export function registerLogRoutes(app: FastifyInstance, deps: PlanRouteDeps): void {
  const clock = deps.clock ?? ((): Date => new Date());
  const unauthorised = (request: FastifyRequest, reply: FastifyReply): FastifyReply =>
    sendError(request, reply, 401, "auth.required", "No valid Owner session.");
  const badRequest = (request: FastifyRequest, reply: FastifyReply, message: string): FastifyReply =>
    sendError(request, reply, 400, "request.invalid", message);
  const outOfRange = (request: FastifyRequest, reply: FastifyReply): FastifyReply =>
    sendError(request, reply, 422, "log.day_out_of_range", "A day after today cannot be logged.");
  const closed = (request: FastifyRequest, reply: FastifyReply): FastifyReply =>
    sendError(request, reply, 409, "day.closed", "The day is closed and never changes.");
  const entryInvalid = (request: FastifyRequest, reply: FastifyReply, reasons: string[]): FastifyReply =>
    sendError(request, reply, 400, "entry.invalid", "The entry is not valid.", { reasons });
  const notFound = (request: FastifyRequest, reply: FastifyReply): FastifyReply =>
    sendError(request, reply, 404, "entry.not_found", "No log entry has this id on this day.");
  const responses = async (entries: StoredEntry[]) => ({
    entries: await Promise.all(entries.map((entry) => toEntryResponse(deps, entry))),
  });

  // IF-001@1.5.0 getDayLog: any valid date; has_plan says which meals have a plan (REQ-014/AC-013).
  app.get("/days/:date/log", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return unauthorised(request, reply);
    const date = (request.params as { date: string }).date;
    if (!isCalendarDate(date)) return badRequest(request, reply, "The date is not a valid calendar date.");
    const today = todayIn(clock(), deps.timeZone);
    const log = await deps.plans.read(date, "log");
    const plan = await deps.plans.read(date);
    const meals = [];
    for (const meal of MEALS) {
      const entries = [];
      for (const entry of log.entries.filter((e) => e.meal === meal)) entries.push(await toEntryResponse(deps, entry));
      meals.push({ meal, has_plan: plan.entries.some((e) => e.meal === meal), entries });
    }
    return reply.code(200).send({
      kind: "log",
      date,
      today,
      closed: log.closed,
      editable: !log.closed && isLoggable(date, today),
      meals,
    });
  });

  // IF-001@1.5.0 addLogEntry. Check order: date and body, window, day open, then the entry. No limit against the plan (REQ-014/AC-006).
  app.post("/days/:date/log/entries", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return unauthorised(request, reply);
    const date = (request.params as { date: string }).date;
    if (!isCalendarDate(date)) return badRequest(request, reply, "The date is not a valid calendar date.");
    const body = asObject(request.body);
    if (!body || Object.keys(body).some((key) => !NEW_ENTRY_KEYS.includes(key)) || !isMeal(body.meal)) {
      return badRequest(request, reply, "The body needs a meal and only known fields.");
    }
    const meal = body.meal;
    if (!isLoggable(date, todayIn(clock(), deps.timeZone))) return outOfRange(request, reply);
    try {
      const saved = await deps.plans.mutate(date, clock(), (tx) => addEntryWork(deps, body, meal, tx), "log");
      return reply.code(201).send(await toEntryResponse(deps, saved));
    } catch (error) {
      if (error instanceof DayClosedError) return closed(request, reply);
      if (error instanceof EntryRefused) return entryInvalid(request, reply, error.reasons);
      throw error;
    }
  });

  // IF-001@1.5.0 addLogDishProducts (ADR-018): one product entry per dish line in one transaction; the dish never changes (REQ-014/AC-010).
  // Check order: session, date and body, window, day open, then the dish and the overrides.
  app.post("/days/:date/log/dish-products", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return unauthorised(request, reply);
    const date = (request.params as { date: string }).date;
    if (!isCalendarDate(date)) return badRequest(request, reply, "The date is not a valid calendar date.");
    const body = asObject(request.body);
    const overrides = body ? readOverrides(body.lines) : undefined;
    if (
      !body ||
      !overrides ||
      Object.keys(body).some((key) => !DISH_PRODUCTS_KEYS.includes(key)) ||
      !isMeal(body.meal) ||
      typeof body.dish_id !== "string"
    ) {
      return badRequest(request, reply, "The body needs a meal, a dish_id and only known fields.");
    }
    const { meal, dish_id: dishId } = body;
    if (!isLoggable(date, todayIn(clock(), deps.timeZone))) return outOfRange(request, reply);
    try {
      const saved = await deps.plans.mutate(date, clock(), (tx) => dishProductsWork(deps, dishId, meal, overrides, tx), "log");
      return reply.code(201).send(await responses(saved));
    } catch (error) {
      if (error instanceof DayClosedError) return closed(request, reply);
      if (error instanceof DishLinesRefused) {
        return sendError(request, reply, 400, "entry.invalid", "The entry is not valid.", {
          reasons: error.reasons,
          lines: error.lines,
        });
      }
      throw error;
    }
  });

  // IF-001@1.5.0 changeLogEntry: only the amount changes; the plan is never touched (REQ-014/AC-002).
  app.patch("/days/:date/log/entries/:entryId", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return unauthorised(request, reply);
    const { date, entryId } = request.params as { date: string; entryId: string };
    if (!isCalendarDate(date)) return badRequest(request, reply, "The date is not a valid calendar date.");
    const body = asObject(request.body);
    if (!body || Object.keys(body).length === 0 || Object.keys(body).some((key) => !CHANGE_KEYS.includes(key))) {
      return badRequest(request, reply, "The body must set grams or pieces.");
    }
    if (!isLoggable(date, todayIn(clock(), deps.timeZone))) return outOfRange(request, reply);
    try {
      const changed = await deps.plans.mutate(date, clock(), (tx) => changeEntryWork(deps, body, entryId, tx), "log");
      return reply.code(200).send(await toEntryResponse(deps, changed));
    } catch (error) {
      if (error instanceof DayClosedError) return closed(request, reply);
      if (error instanceof EntryMissing) return notFound(request, reply);
      if (error instanceof EntryRefused) return entryInvalid(request, reply, error.reasons);
      throw error;
    }
  });

  // IF-001@1.5.0 removeLogEntry.
  app.delete("/days/:date/log/entries/:entryId", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return unauthorised(request, reply);
    const { date, entryId } = request.params as { date: string; entryId: string };
    if (!isCalendarDate(date)) return badRequest(request, reply, "The date is not a valid calendar date.");
    if (!isLoggable(date, todayIn(clock(), deps.timeZone))) return outOfRange(request, reply);
    try {
      await deps.plans.mutate(
        date,
        clock(),
        async (tx) => {
          if (!(await tx.remove(entryId))) throw new EntryMissing();
        },
        "log",
      );
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof DayClosedError) return closed(request, reply);
      if (error instanceof EntryMissing) return notFound(request, reply);
      throw error;
    }
  });

  // IF-001@1.5.0 confirmMealAsPlanned: copies the plan rows of the meal into log rows in one transaction (ADR-017, REQ-014/AC-001).
  app.post("/days/:date/log/meals/:meal/confirm", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return unauthorised(request, reply);
    const { date, meal } = request.params as { date: string; meal: string };
    if (!isCalendarDate(date) || !isMeal(meal)) return badRequest(request, reply, "The date or the meal is not valid.");
    if (!isLoggable(date, todayIn(clock(), deps.timeZone))) return outOfRange(request, reply);
    const target: Meal = meal;
    try {
      const copies = await deps.plans.mutate(
        date,
        clock(),
        async (tx) => {
          const planned = await tx.list(target, "plan");
          if (planned.length === 0) throw new PlanEmpty();
          if ((await tx.list(target, "log")).length > 0) throw new LogNotEmpty();
          const saved: StoredEntry[] = [];
          for (const row of planned) {
            saved.push(
              await tx.add({
                meal: target,
                product_id: row.product_id,
                dish_id: row.dish_id,
                grams: row.grams,
                pieces: row.pieces,
                from_dish_id: row.from_dish_id,
              }),
            );
          }
          return saved;
        },
        "log",
      );
      return reply.code(201).send(await responses(copies));
    } catch (error) {
      if (error instanceof DayClosedError) return closed(request, reply);
      if (error instanceof PlanEmpty) return sendError(request, reply, 409, "plan.meal_empty", "The plan has no entry for this meal.");
      if (error instanceof LogNotEmpty) return sendError(request, reply, 409, "log.meal_not_empty", "The log of this meal already has entries.");
      throw error;
    }
  });
}
