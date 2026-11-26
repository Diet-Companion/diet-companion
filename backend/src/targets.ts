import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { TARGET_NUTRIENTS, isTargetNutrient, type StoredRange, type TargetNutrient, type TargetStore } from "./target-store.js";
import { todayIn } from "./today.js";

/** Dependencies of the target range routes (CMP-002, IF-001@1.4.0). */
export interface TargetRouteDeps {
  targets: TargetStore;
  /** The owner check hook. Absent: every request is refused (fail closed, ADR-004/C-005). */
  isOwner?: (request: FastifyRequest) => boolean | Promise<boolean>;
  /** The clock seam: today comes from here and the zone (ADR-016/C-001). */
  clock?: () => Date;
  /** The Owner's IANA zone (ADR-016/C-002). */
  timeZone: string;
}

export interface TargetRangeResponse {
  nutrient: TargetNutrient;
  minimum: number;
  maximum: number;
  unit: "kcal" | "g";
  effective_from: string;
}

export interface TargetRangesResponse {
  as_of: string;
  setup_complete: boolean;
  calories: TargetRangeResponse | null;
  protein: TargetRangeResponse | null;
  fat: TargetRangeResponse | null;
}

const UNITS: Record<TargetNutrient, "kcal" | "g"> = { calories: "kcal", protein: "g", fat: "g" };

/** The largest limit IF-001@1.4.0 accepts (TargetRangeInput maximum). */
export const MAX_LIMIT = 2147483647;

export function toTargetRangeResponse(row: StoredRange): TargetRangeResponse {
  return {
    nutrient: row.nutrient,
    minimum: row.minimum,
    maximum: row.maximum,
    unit: UNITS[row.nutrient],
    effective_from: row.effective_from,
  };
}

/** The ranges in force on a date. The one shared function for both reads (ADR-015/C-003). */
export async function rangesInForce(store: TargetStore, date: string): Promise<TargetRangesResponse> {
  const found = await Promise.all(TARGET_NUTRIENTS.map((nutrient) => store.rangeInForce(nutrient, date)));
  const [calories, protein, fat] = found.map((row) => (row ? toTargetRangeResponse(row) : null));
  return {
    as_of: date,
    setup_complete: found.every((row) => row !== undefined),
    calories: calories ?? null,
    protein: protein ?? null,
    fat: fat ?? null,
  };
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

type Limit = "minimum" | "maximum";

export type RangeCheck =
  | { ok: true; minimum: number; maximum: number }
  | { ok: false; status: 400 | 422; code: string; message: string; field: "invalid" | "missing"; limits: Limit[] };

/**
 * R-011 and IF-001@1.4.0 setTargetRange: both limits present, each a whole number from 0 to 2147483647,
 * and the minimum not above the maximum (equal is allowed). Fields other than minimum and maximum are ignored.
 */
export function checkTargetRangeInput(body: unknown): RangeCheck {
  const source = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const limits: Limit[] = ["minimum", "maximum"];
  const missing = limits.filter((name) => source[name] === undefined || source[name] === null);
  if (missing.length > 0) {
    return {
      ok: false,
      status: 422,
      code: "target.values_missing",
      message: "Both the minimum and the maximum are required.",
      field: "missing",
      limits: missing,
    };
  }
  const bad = limits.filter((name) => {
    const value = source[name];
    return typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_LIMIT;
  });
  if (bad.length > 0) {
    return {
      ok: false,
      status: 400,
      code: "target.value_invalid",
      message: "A limit must be a whole number from 0 to 2147483647.",
      field: "invalid",
      limits: bad,
    };
  }
  const minimum = source["minimum"] as number;
  const maximum = source["maximum"] as number;
  if (minimum > maximum) {
    return {
      ok: false,
      status: 400,
      code: "target.range_inverted",
      message: "The minimum may not be above the maximum.",
      field: "invalid",
      limits: ["minimum", "maximum"],
    };
  }
  return { ok: true, minimum, maximum };
}

function sendError(request: FastifyRequest, reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  const runId = request.headers["x-run-id"];
  return reply.code(status).send({ code, message, ...(typeof runId === "string" ? { run_id: runId } : {}) });
}

async function requireOwner(deps: TargetRouteDeps, request: FastifyRequest): Promise<boolean> {
  if (!deps.isOwner) return false;
  try {
    return await deps.isOwner(request);
  } catch {
    return false;
  }
}

export function registerTargetRoutes(app: FastifyInstance, deps: TargetRouteDeps): void {
  const clock = deps.clock ?? ((): Date => new Date());

  // IF-001@1.4.0 getTargetRanges: today comes from the clock and the zone, never from the request (ADR-016/C-001).
  app.get("/target-ranges", async (request, reply) => {
    if (!(await requireOwner(deps, request))) {
      return sendError(request, reply, 401, "auth.required", "No valid Owner session.");
    }
    return reply.code(200).send(await rangesInForce(deps.targets, todayIn(clock(), deps.timeZone)));
  });

  // IF-001@1.4.0 getTargetRangesOn: the ranges in force on a calendar date, for the journal.
  app.get("/target-ranges/on/:date", async (request, reply) => {
    if (!(await requireOwner(deps, request))) {
      return sendError(request, reply, 401, "auth.required", "No valid Owner session.");
    }
    const date = (request.params as { date: string }).date;
    if (!isCalendarDate(date)) {
      return sendError(request, reply, 400, "request.invalid", "The date is not a valid calendar date.");
    }
    return reply.code(200).send(await rangesInForce(deps.targets, date));
  });

  // IF-001@1.4.0 setTargetRange: one nutrient per request, effective from today (ADR-015/C-002, ADR-016/C-001).
  // A refused save returns before the store is called, so nothing is written (REQ-009/AC-002, AC-010).
  app.put("/target-ranges/:nutrient", async (request, reply) => {
    if (!(await requireOwner(deps, request))) {
      return sendError(request, reply, 401, "auth.required", "No valid Owner session.");
    }
    const nutrient = (request.params as { nutrient: string }).nutrient;
    if (!isTargetNutrient(nutrient)) {
      return sendError(request, reply, 404, "target.nutrient_unknown", "Only calories, protein and fat have a range.");
    }
    const checked = checkTargetRangeInput(request.body);
    if (!checked.ok) {
      const runId = request.headers["x-run-id"];
      return reply.code(checked.status).send({
        code: checked.code,
        message: checked.message,
        ...(typeof runId === "string" ? { run_id: runId } : {}),
        [checked.field]: checked.limits,
      });
    }
    // The date is never read from the request: any date or weekday field in the body is ignored (REQ-009/AC-007).
    const saved = await deps.targets.save({
      nutrient,
      minimum: checked.minimum,
      maximum: checked.maximum,
      effective_from: todayIn(clock(), deps.timeZone),
    });
    return reply.code(200).send(toTargetRangeResponse(saved));
  });
}
