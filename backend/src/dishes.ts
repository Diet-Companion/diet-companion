import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  DishNotSelectableError,
  isDishSelectable,
  type DishChanges,
  type DishRecord,
  type DishStore,
  type NewDishLine,
} from "./dish-store.js";
import { isSelectable, toProductResponse, type ListState, type ProductResponse, type ProductStore } from "./products.js";

/** Dependencies of the dish routes (CMP-002, IF-001@1.3.0). */
export interface DishRouteDeps {
  dishes: DishStore;
  /** Products are read here for every line, in any state (ADR-014, R-009). */
  products: ProductStore;
  /** The owner check hook. Absent: every request is refused (fail closed, ADR-004/C-005). */
  isOwner?: (request: FastifyRequest) => boolean | Promise<boolean>;
  /** The clock seam: the creation time and deleted_at come from here. */
  clock?: () => Date;
}

export interface DishLineResponse {
  position: number;
  product: ProductResponse;
  grams: number | null;
  pieces: number | null;
  weight_grams: number;
}

export interface DishResponse {
  id: string;
  name: string;
  lines: DishLineResponse[];
  total_weight_grams: number;
  replaced_by: string | null;
  deleted: boolean;
  selectable: boolean;
  has_unselectable_product: boolean;
}

type LineReason = "product_not_found" | "product_not_selectable" | "piece_without_weight" | "amount_invalid";

const LINE_KEYS: readonly string[] = ["product_id", "grams", "pieces"];
const LIST_STATES: readonly string[] = ["selectable", "deleted"];
const EDIT_KEYS: readonly string[] = ["name", "lines"];

/**
 * A dish as IF-001@1.3.0 returns it. Each line shows its product by the exact id saved, in its current state
 * (R-009, AC-015, AC-018). Weight is grams as saved, or pieces times the piece weight of that product (AC-002).
 */
export async function toDishResponse(products: ProductStore, record: DishRecord): Promise<DishResponse> {
  const lines: DishLineResponse[] = [];
  let hasUnselectable = false;
  for (const line of record.dish.lines) {
    const found = await products.get(line.product_id);
    if (!found) throw new Error("a dish line names a product that does not exist");
    if (!isSelectable(found.state)) hasUnselectable = true;
    const weight = line.grams ?? (line.pieces ?? 0) * (found.product.piece_weight ?? 0);
    lines.push({
      position: line.position,
      product: toProductResponse(found.product, found.state),
      grams: line.grams,
      pieces: line.pieces,
      weight_grams: weight,
    });
  }
  return {
    id: record.dish.id,
    name: record.dish.name,
    lines,
    total_weight_grams: lines.reduce((sum, l) => sum + l.weight_grams, 0),
    replaced_by: record.state.replaced_by,
    deleted: record.state.deleted_at !== null,
    selectable: isDishSelectable(record.state),
    has_unselectable_product: hasUnselectable,
  };
}

/**
 * One request line: the line to save, or the reason it is refused (R-007, ADR-014). A product id already in the dish
 * (`carried`) skips only the selectable check (ADR-014 option a).
 */
async function checkLine(
  products: ProductStore,
  input: unknown,
  carried: ReadonlySet<string> = new Set(),
): Promise<NewDishLine | LineReason> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "amount_invalid";
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !LINE_KEYS.includes(key))) return "amount_invalid";
  const hasGrams = body.grams !== undefined;
  const hasPieces = body.pieces !== undefined;
  const amount = hasGrams ? body.grams : body.pieces;
  if (hasGrams === hasPieces || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return "amount_invalid";
  }
  const found = typeof body.product_id === "string" ? await products.get(body.product_id) : undefined;
  if (!found) return "product_not_found";
  if (!isSelectable(found.state) && !carried.has(found.product.id)) return "product_not_selectable";
  if (hasPieces && !((found.product.piece_weight ?? 0) > 0)) return "piece_without_weight";
  return { product_id: found.product.id, grams: hasGrams ? amount : null, pieces: hasPieces ? amount : null };
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

async function requireOwner(deps: DishRouteDeps, request: FastifyRequest): Promise<boolean> {
  if (!deps.isOwner) return false;
  try {
    return await deps.isOwner(request);
  } catch {
    return false;
  }
}

function refuseUnauthorised(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendError(request, reply, 401, "auth.required", "No valid Owner session.");
}

function refuseNotSelectable(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendError(request, reply, 409, "dish.not_selectable", "The dish was replaced by a newer version or deleted.");
}

/** Runs a read or state change on the dish named by :id and maps its outcomes to IF-001@1.3.0. */
async function withDish(
  deps: DishRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  run: (id: string) => Promise<DishRecord | undefined>,
): Promise<FastifyReply> {
  try {
    const record = await run((request.params as { id: string }).id);
    if (!record) return sendError(request, reply, 404, "dish.not_found", "No dish has this id.");
    return reply.code(200).send(await toDishResponse(deps.products, record));
  } catch (error) {
    if (error instanceof DishNotSelectableError) {
      return sendError(request, reply, 409, "dish.not_selectable", "The dish was replaced by a newer version.");
    }
    throw error;
  }
}

export function registerDishRoutes(app: FastifyInstance, deps: DishRouteDeps): void {
  const clock = deps.clock ?? ((): Date => new Date());

  // IF-001@1.3.0 listDishes: selectable by default, soft-deleted with state=deleted (R-008, R-010).
  app.get("/dishes", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return refuseUnauthorised(request, reply);
    const asked = (request.query as { state?: unknown }).state ?? "selectable";
    if (typeof asked !== "string" || !LIST_STATES.includes(asked)) {
      return sendError(request, reply, 400, "request.invalid", "state must be selectable or deleted.");
    }
    const records = await deps.dishes.listByState(asked as ListState);
    const out: DishResponse[] = [];
    for (const record of records) out.push(await toDishResponse(deps.products, record));
    return reply.code(200).send(out);
  });

  // IF-001@1.3.0 createDish: R-007, ADR-014, duplicate names allowed (R-010). Nothing is saved when a check fails.
  app.post("/dishes", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return refuseUnauthorised(request, reply);
    const body: Record<string, unknown> =
      typeof request.body === "object" && request.body !== null && !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const inputs: unknown[] = Array.isArray(body.lines) ? (body.lines as unknown[]) : [];
    const missing: string[] = [];
    if (name === "") missing.push("name");
    if (inputs.length === 0) missing.push("lines");
    if (missing.length > 0) {
      return sendError(request, reply, 422, "dish.values_missing", "Required values are missing.", { missing });
    }

    const lines: NewDishLine[] = [];
    const refused: { index: number; reason: LineReason }[] = [];
    for (const [index, input] of inputs.entries()) {
      const result = await checkLine(deps.products, input);
      if (typeof result === "string") refused.push({ index, reason: result });
      else lines.push(result);
    }
    if (refused.length > 0) {
      return sendError(request, reply, 400, "dish.line_invalid", "One or more lines are refused.", { lines: refused });
    }
    const saved = await deps.dishes.add({ name, lines }, clock());
    return reply.code(201).send(await toDishResponse(deps.products, saved));
  });

  // IF-001@1.3.0 getDish: any dish by id, in any state (ADR-012/C-003).
  app.get("/dishes/:id", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return refuseUnauthorised(request, reply);
    return withDish(deps, request, reply, (id) => deps.dishes.get(id));
  });

  // IF-001@1.3.0 editDish: R-008, ADR-013 a, ADR-014 a. A lines change records a new dish (201); a name-only change
  // or no change answers 200. Nothing is saved when a check fails.
  app.patch("/dishes/:id", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return refuseUnauthorised(request, reply);
    const raw = request.body;
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw) ||
      Object.keys(raw).length === 0 ||
      Object.keys(raw).some((key) => !EDIT_KEYS.includes(key))
    ) {
      return sendError(request, reply, 400, "request.invalid", "The body must set name, lines or both.");
    }
    const body = raw as Record<string, unknown>;
    if (
      (body.name !== undefined && typeof body.name !== "string") ||
      (body.lines !== undefined && !Array.isArray(body.lines))
    ) {
      return sendError(request, reply, 400, "request.invalid", "name must be a string and lines an array.");
    }

    const id = (request.params as { id: string }).id;
    const current = await deps.dishes.get(id);
    if (!current) return sendError(request, reply, 404, "dish.not_found", "No dish has this id.");
    if (!isDishSelectable(current.state)) return refuseNotSelectable(request, reply);

    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    const inputs = Array.isArray(body.lines) ? (body.lines as unknown[]) : undefined;
    const missing: string[] = [];
    if (name === "") missing.push("name");
    if (inputs !== undefined && inputs.length === 0) missing.push("lines");
    if (missing.length > 0) {
      return sendError(request, reply, 422, "dish.values_missing", "Required values are missing.", { missing });
    }

    const changes: DishChanges = {};
    if (name !== undefined) changes.name = name;
    if (inputs !== undefined) {
      const carried = new Set(current.dish.lines.map((line) => line.product_id));
      const lines: NewDishLine[] = [];
      const refused: { index: number; reason: LineReason }[] = [];
      for (const [index, input] of inputs.entries()) {
        const result = await checkLine(deps.products, input, carried);
        if (typeof result === "string") refused.push({ index, reason: result });
        else lines.push(result);
      }
      if (refused.length > 0) {
        return sendError(request, reply, 400, "dish.line_invalid", "One or more lines are refused.", { lines: refused });
      }
      changes.lines = lines;
    }

    try {
      const outcome = await deps.dishes.edit(id, changes, clock());
      if (!outcome) return sendError(request, reply, 404, "dish.not_found", "No dish has this id.");
      return reply.code(outcome.versioned ? 201 : 200).send({
        dish: await toDishResponse(deps.products, outcome.record),
        versioned: outcome.versioned,
        replaced_id: outcome.replaced_id,
      });
    } catch (error) {
      if (error instanceof DishNotSelectableError) return refuseNotSelectable(request, reply);
      throw error;
    }
  });

  // IF-001@1.3.0 deleteDish: soft delete, deleted_at from the injected clock (R-010).
  app.delete("/dishes/:id", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return refuseUnauthorised(request, reply);
    return withDish(deps, request, reply, (id) => deps.dishes.softDelete(id, clock()));
  });

  // IF-001@1.3.0 restoreDish: lines unchanged (R-010, A-010).
  app.post("/dishes/:id/restore", async (request, reply) => {
    if (!(await requireOwner(deps, request))) return refuseUnauthorised(request, reply);
    return withDish(deps, request, reply, (id) => deps.dishes.restore(id));
  });
}
