// IF-001@1.3.0 dish operations (REQ-006): listDishes, deleteDish, restoreDish. Fetch and run id are injected.

import type { FetchLike } from "./api";

export interface DishProduct {
  id: string;
  name: string;
  deleted?: boolean;
  selectable?: boolean;
}

export interface DishLine {
  position: number;
  product: DishProduct;
  grams: number | null;
  pieces: number | null;
  weight_grams: number;
}

export interface Dish {
  id: string;
  name: string;
  lines: DishLine[];
  total_weight_grams: number;
  replaced_by: string | null;
  deleted: boolean;
  selectable: boolean;
  has_unselectable_product: boolean;
}

export type DishState = "selectable" | "deleted";

export type DishListResult =
  | { kind: "ok"; dishes: Dish[] }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string | null };

export type DishChangeResult =
  | { kind: "ok"; dish: Dish }
  | { kind: "not_selectable"; message: string | null }
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "failed"; message: string | null };

export interface DishApi {
  listDishes(state: DishState): Promise<DishListResult>;
  deleteDish(id: string): Promise<DishChangeResult>;
  restoreDish(id: string): Promise<DishChangeResult>;
}

type Rec = Record<string, unknown>;

function isRec(x: unknown): x is Rec {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function messageOf(body: unknown): string | null {
  return isRec(body) && typeof body.message === "string" && body.message !== "" ? body.message : null;
}

function parseLine(raw: unknown): DishLine | null {
  if (!isRec(raw) || !isRec(raw.product)) return null;
  const p = raw.product;
  const { position, grams, pieces, weight_grams } = raw;
  if (
    typeof p.id !== "string" ||
    typeof p.name !== "string" ||
    typeof position !== "number" ||
    typeof weight_grams !== "number"
  ) {
    return null;
  }
  const product: DishProduct = { id: p.id, name: p.name };
  if (typeof p.deleted === "boolean") product.deleted = p.deleted;
  if (typeof p.selectable === "boolean") product.selectable = p.selectable;
  return {
    position,
    product,
    grams: typeof grams === "number" ? grams : null,
    pieces: typeof pieces === "number" ? pieces : null,
    weight_grams,
  };
}

export function parseDish(raw: unknown): Dish | null {
  if (!isRec(raw) || !Array.isArray(raw.lines)) return null;
  const lines: DishLine[] = [];
  for (const l of raw.lines) {
    const line = parseLine(l);
    if (!line) return null;
    lines.push(line);
  }
  const { id, name, total_weight_grams, replaced_by, deleted, selectable, has_unselectable_product } = raw;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof total_weight_grams !== "number" ||
    typeof deleted !== "boolean" ||
    typeof selectable !== "boolean" ||
    typeof has_unselectable_product !== "boolean"
  ) {
    return null;
  }
  return {
    id,
    name,
    lines,
    total_weight_grams,
    replaced_by: typeof replaced_by === "string" ? replaced_by : null,
    deleted,
    selectable,
    has_unselectable_product,
  };
}

export function createDishApi(fetchFn: FetchLike, newRunId: () => string): DishApi {
  async function send(url: string, method: string): Promise<{ status: number; body: unknown } | null> {
    try {
      const res = await fetchFn(url, { method, headers: { "X-Run-Id": newRunId() } });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { status: res.status, body };
    } catch {
      return null;
    }
  }

  async function change(url: string, method: string): Promise<DishChangeResult> {
    const r = await send(url, method);
    if (!r) return { kind: "failed", message: null };
    if (r.status === 200) {
      const dish = parseDish(r.body);
      return dish ? { kind: "ok", dish } : { kind: "failed", message: null };
    }
    if (r.status === 401) return { kind: "unauthorized" };
    if (r.status === 404) return { kind: "not_found" };
    if (r.status === 409 && isRec(r.body) && r.body.code === "dish.not_selectable") {
      return { kind: "not_selectable", message: messageOf(r.body) };
    }
    return { kind: "failed", message: messageOf(r.body) };
  }

  return {
    async listDishes(state) {
      const r = await send(state === "deleted" ? "/dishes?state=deleted" : "/dishes", "GET");
      if (!r) return { kind: "failed", message: null };
      if (r.status === 401) return { kind: "unauthorized" };
      if (r.status === 200 && Array.isArray(r.body)) {
        const dishes: Dish[] = [];
        for (const raw of r.body) {
          const dish = parseDish(raw);
          if (dish) dishes.push(dish);
        }
        return { kind: "ok", dishes };
      }
      return { kind: "failed", message: messageOf(r.body) };
    },
    deleteDish: (id) => change(`/dishes/${encodeURIComponent(id)}`, "DELETE"),
    restoreDish: (id) => change(`/dishes/${encodeURIComponent(id)}/restore`, "POST"),
  };
}
