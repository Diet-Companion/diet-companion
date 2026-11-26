import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isDishSelectable, type DishStore } from "./dish-store.js";
import { toDishResponse, type DishResponse } from "./dishes.js";
import { DayClosedError, MEALS, isMeal, type PlanStore, type StoredEntry } from "./plan-store.js";
import { isSelectable, toProductResponse, type ProductResponse, type ProductStore } from "./products.js";
import { isCalendarDate } from "./targets.js";
import { todayIn } from "./today.js";

/** Dependencies of the day plan routes (CMP-002, IF-001@1.5.0). */
export interface PlanRouteDeps {
  plans: PlanStore;
  products: ProductStore;
  dishes: DishStore;
  /** The owner check hook. Absent: every request is refused (fail closed, ADR-004/C-005). */
  isOwner?: (request: FastifyRequest) => boolean | Promise<boolean>;
  /** The clock seam: today and the creation time come from here (ADR-016/C-001). */
  clock?: () => Date;
  /** The Owner's IANA zone (ADR-016/C-002). */
  timeZone: string;
}

export interface EntryResponse {
  id: string;
  meal: string;
  position: number;
  product: ProductResponse | null;
  dish: DishResponse | null;
  grams: number | null;
  pieces: number | null;
  from_dish_id: string | null;
  weight_grams: number;
}

/** The largest amount the integer columns of day_entries hold (migration 007). */
const MAX_AMOUNT = 2147483647;
const NEW_ENTRY_KEYS: readonly string[] = ["meal", "product_id", "grams", "pieces", "dish_id"];
const CHANGE_KEYS: readonly string[] = ["grams", "pieces"];

/** The next calendar day of a YYYY-MM-DD date. */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** R-013, REQ-013/AC-004: only today and the next day can be planned. */
export function isPlannable(date: string, today: string): boolean {
  return date === today || date === nextDay(today);
}

/** The entry was refused by the entry checks; thrown inside the transaction so nothing is saved. */
class EntryRefused extends Error {
  constructor(readonly reasons: string[]) {
    super("entry refused");
  }
}

class EntryMissing extends Error {}

type Amount = { grams: number | null; pieces: number | null };

/** Exactly one of grams and pieces, a whole number of 1 or more (R-007, REQ-013/AC-005, AC-006). */
function readAmount(body: Record<string, unknown>): Amount | "amount_missing" | "amount_invalid" {
  const hasGrams = body.grams !== undefined;
  const hasPieces = body.pieces !== undefined;
  if (hasGrams === hasPieces) return "amount_missing";
  const value = hasGrams ? body.grams : body.pieces;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_AMOUNT) {
    return "amount_invalid";
  }
  return { grams: hasGrams ? value : null, pieces: hasPieces ? value : null };
}

function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): FastifyReply {
  const runId = request.headers["x-run-id"];
  return reply.code(status).send({
    code,
    message,
    ...(typeof runId === "string" ? { run_id: runId } : {}),
    ...extra,
  });
}

async function requireOwner(deps: PlanRouteDeps, request: FastifyRequest): Promise<boolean> {
  if (!deps.isOwner) return false;
  try {
    return await deps.isOwner(request);
  } catch {
    return false;
  }
}

async function toEntryResponse(deps: PlanRouteDeps, entry: StoredEntry): Promise<EntryResponse> {
  let product: ProductResponse | null = null;
  let dish: DishResponse | null = null;
  let weight = 0;
  if (entry.product_id !== null) {
    const found = await deps.products.get(entry.product_id);
    if (!found) throw new Error("a plan entry names a product that does not exist");
    product = toProductResponse(found.product, found.state);
    weight = entry.grams ?? (entry.pieces ?? 0) * (found.product.piece_weight ?? 0);
  } else if (entry.dish_id !== null) {
    const found = await deps.dishes.get(entry.dish_id);
    if (!found) throw new Error("a plan entry names a dish that does not exist");
    dish = await toDishResponse(deps.products, found);
    weight = dish.total_weight_grams;
  }
  return {
    id: entry.id,
    meal: entry.meal,
    position: entry.position,
    product,
    dish,
    grams: entry.grams,
    pieces: entry.pieces,
    from_dish_id: entry.from_dish_id,
    weight_grams: weight,
  };
}

function asObject(body: unknown): Record<string, unknown> | undefined {
  if (body === undefined || body === null) return {};
  return typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
}

export function registerPlanRoutes(app: FastifyInstance, deps: PlanRouteDeps): void {
  const clock = deps.clock ?? ((): Date => new Date());
  const unauthorised = (request: FastifyRequest, reply: FastifyReply): FastifyReply =>
    sendError(request, reply, 401, "auth.required", "No valid Owner session.");
  const badRequest = (request: FastifyRequest, reply: FastifyReply, message: string): FastifyReply =>
    sendError(request, reply, 400, "request.invalid", message);
  const outOfRange = (request: FastifyRequest, reply: FastifyReply): FastifyReply =>
    sendError(request, reply, 422, "plan.day_out_of_range", "Only today and the next day can be planned.");
  const closed = (request: FastifyRequest, reply: FastifyReply): FastifyReply =>
    sendError(request, reply, 409, "day.closed", "The day is closed and never changes.");
  const entryInvalid = (request: FastifyRequest, reply: FastifyReply, reasons: string[]): FastifyReply =>
    sendError(request, reply, 400, "entry.invalid", "The entry is not valid.", { reasons });
  const notFound = (request: FastifyRequest, reply: FastifyReply): FastifyReply =>
    sendError(request, reply, 404, "entry.not_found", "No plan entry has this id on this day.");

  // IF-001@1.5.0 getDayPlan: any valid date; reading a closed day works (ADR-019/C-002).
  app.get("/days/:date/plan", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return unauthorised(request, reply);
    const date = (request.params as { date: string }).date;
    if (!isCalendarDate(date)) return badRequest(request, reply, "The date is not a valid calendar date.");
    const today = todayIn(clock(), deps.timeZone);
    const day = await deps.plans.read(date);
    const meals = [];
    for (const meal of MEALS) {
      const entries = [];
      for (const entry of day.entries.filter((e) => e.meal === meal)) entries.push(await toEntryResponse(deps, entry));
      meals.push({ meal, has_plan: entries.length > 0, entries });
    }
    return reply.code(200).send({
      kind: "plan",
      date,
      today,
      closed: day.closed,
      editable: !day.closed && isPlannable(date, today),
      meals,
    });
  });

  // IF-001@1.5.0 addPlanEntry. Check order: date and body, day window, day open, then the entry.
  app.post("/days/:date/plan/entries", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return unauthorised(request, reply);
    const date = (request.params as { date: string }).date;
    if (!isCalendarDate(date)) return badRequest(request, reply, "The date is not a valid calendar date.");
    const body = asObject(request.body);
    if (!body || Object.keys(body).some((key) => !NEW_ENTRY_KEYS.includes(key)) || !isMeal(body.meal)) {
      return badRequest(request, reply, "The body needs a meal and only known fields.");
    }
    const meal = body.meal;
    if (!isPlannable(date, todayIn(clock(), deps.timeZone))) return outOfRange(request, reply);

    try {
      const saved = await deps.plans.mutate(date, clock(), async (tx) => {
        const reasons: string[] = [];
        const hasProduct = body.product_id !== undefined;
        const hasDish = body.dish_id !== undefined;
        if (hasProduct === hasDish) throw new EntryRefused(["subject_missing"]);
        if (hasDish) {
          if (body.grams !== undefined || body.pieces !== undefined) reasons.push("amount_on_dish");
          const found = typeof body.dish_id === "string" ? await deps.dishes.get(body.dish_id) : undefined;
          if (!found) reasons.push("dish_not_found");
          else if (!isDishSelectable(found.state)) reasons.push("dish_not_selectable");
          if (reasons.length > 0 || !found) throw new EntryRefused(reasons);
          return tx.add({ meal, product_id: null, dish_id: found.dish.id, grams: null, pieces: null, from_dish_id: null });
        }
        const amount = readAmount(body);
        if (typeof amount === "string") reasons.push(amount);
        const found = typeof body.product_id === "string" ? await deps.products.get(body.product_id) : undefined;
        if (!found) reasons.push("product_not_found");
        else {
          if (!isSelectable(found.state)) reasons.push("product_not_selectable");
          if (typeof amount !== "string" && amount.pieces !== null && !((found.product.piece_weight ?? 0) > 0)) {
            reasons.push("piece_without_weight");
          }
        }
        if (reasons.length > 0 || !found || typeof amount === "string") throw new EntryRefused(reasons);
        return tx.add({
          meal,
          product_id: found.product.id,
          dish_id: null,
          grams: amount.grams,
          pieces: amount.pieces,
          from_dish_id: null,
        });
      });
      return reply.code(201).send(await toEntryResponse(deps, saved));
    } catch (error) {
      if (error instanceof DayClosedError) return closed(request, reply);
      if (error instanceof EntryRefused) return entryInvalid(request, reply, error.reasons);
      throw error;
    }
  });

  // IF-001@1.5.0 changePlanEntry: only the amount changes (A-038).
  app.patch("/days/:date/plan/entries/:entryId", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return unauthorised(request, reply);
    const { date, entryId } = request.params as { date: string; entryId: string };
    if (!isCalendarDate(date)) return badRequest(request, reply, "The date is not a valid calendar date.");
    const body = asObject(request.body);
    if (!body || Object.keys(body).length === 0 || Object.keys(body).some((key) => !CHANGE_KEYS.includes(key))) {
      return badRequest(request, reply, "The body must set grams or pieces.");
    }
    if (!isPlannable(date, todayIn(clock(), deps.timeZone))) return outOfRange(request, reply);

    try {
      const changed = await deps.plans.mutate(date, clock(), async (tx) => {
        const current = await tx.find(entryId);
        if (!current) throw new EntryMissing();
        if (current.product_id === null) throw new EntryRefused(["amount_on_dish"]);
        const amount = readAmount(body);
        if (typeof amount === "string") throw new EntryRefused([amount]);
        if (amount.pieces !== null) {
          const found = await deps.products.get(current.product_id);
          if (!((found?.product.piece_weight ?? 0) > 0)) throw new EntryRefused(["piece_without_weight"]);
        }
        const saved = await tx.setAmount(entryId, amount);
        if (!saved) throw new EntryMissing();
        return saved;
      });
      return reply.code(200).send(await toEntryResponse(deps, changed));
    } catch (error) {
      if (error instanceof DayClosedError) return closed(request, reply);
      if (error instanceof EntryMissing) return notFound(request, reply);
      if (error instanceof EntryRefused) return entryInvalid(request, reply, error.reasons);
      throw error;
    }
  });

  // IF-001@1.5.0 removePlanEntry: deletes the row (A-039); the others keep their order.
  app.delete("/days/:date/plan/entries/:entryId", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return unauthorised(request, reply);
    const { date, entryId } = request.params as { date: string; entryId: string };
    if (!isCalendarDate(date)) return badRequest(request, reply, "The date is not a valid calendar date.");
    if (!isPlannable(date, todayIn(clock(), deps.timeZone))) return outOfRange(request, reply);

    try {
      await deps.plans.mutate(date, clock(), async (tx) => {
        if (!(await tx.remove(entryId))) throw new EntryMissing();
      });
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof DayClosedError) return closed(request, reply);
      if (error instanceof EntryMissing) return notFound(request, reply);
      throw error;
    }
  });
}
