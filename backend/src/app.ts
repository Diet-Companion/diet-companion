import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import { createAuth, type AuthDeps } from "./auth/auth.js";
import type { DishStore } from "./dish-store.js";
import { registerDishRoutes } from "./dishes.js";
import { InMemoryDishStore } from "./in-memory-dish-store.js";
import {
  InMemoryProductStore,
  MAX_PHOTO_BYTES,
  registerProductRoutes,
  type ProductRouteDeps,
} from "./products.js";
import { InMemoryTargetStore, type TargetStore } from "./target-store.js";
import { registerTargetRoutes } from "./targets.js";

export type ReadinessCheck = () => boolean | Promise<boolean>;

/** Dependency checks for GET /readiness. An unset check is not reported. */
export interface ReadinessChecks {
  database?: ReadinessCheck;
  label_reader?: ReadinessCheck;
}

export interface AppOptions extends Partial<ProductRouteDeps> {
  checks?: ReadinessChecks;
  /**
   * The Owner login (ADR-004 option d). When set, its session check guards the product routes and
   * it takes precedence over isOwner. With neither, every product request is refused (fail closed).
   */
  auth?: AuthDeps;
  /** The dish storage seam (IF-001@1.3.0 dish routes). Default: an in-memory store. */
  dishStore?: DishStore;
  /** The target range storage seam (IF-001@1.4.0). Default: an in-memory store. */
  targetStore?: TargetStore;
  /**
   * The Owner's IANA time zone (ADR-016). The production entry always passes the parsed OWNER_TIME_ZONE;
   * the UTC default is for tests that do not care about the day boundary.
   */
  timeZone?: string;
}

interface ReadinessBody {
  ready: boolean;
  database?: boolean;
  label_reader?: boolean;
}

async function runCheck(check: ReadinessCheck): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify();
  const checks = options.checks ?? {};
  const auth = options.auth ? createAuth(options.auth) : undefined;

  // Correlation id echoed on every response (IF-001 RunId, CMP-002 run_id_correlation).
  app.addHook("onRequest", async (request, reply) => {
    const runId = request.headers["x-run-id"];
    if (typeof runId === "string") {
      reply.header("X-Run-Id", runId);
    }
  });

  // IF-001@1.0.0 getReadiness.
  app.get("/readiness", async (_request, reply) => {
    const body: ReadinessBody = { ready: true };
    if (checks.database) {
      body.database = await runCheck(checks.database);
    }
    if (checks.label_reader) {
      body.label_reader = await runCheck(checks.label_reader);
    }
    body.ready = body.database !== false && body.label_reader !== false;
    return reply.code(body.ready ? 200 : 503).send(body);
  });

  // IF-001@1.0.0 loginOwner and logout.
  if (auth) auth.registerRoutes(app);

  // IF-001 product and dish operations. The photo is read in memory only: one file, size limited, never written anywhere.
  void app.register(multipart, { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } });
  const products = options.store ?? new InMemoryProductStore(randomUUID);
  const isOwner: ProductRouteDeps["isOwner"] = auth ? (request) => auth.isOwner(request) : options.isOwner;
  registerProductRoutes(app, {
    store: products,
    labelProvider: options.labelProvider,
    isOwner,
    clock: options.clock,
  });
  registerDishRoutes(app, {
    dishes: options.dishStore ?? new InMemoryDishStore(randomUUID),
    products,
    isOwner,
    clock: options.clock,
  });
  // IF-001@1.4.0 target range operations.
  registerTargetRoutes(app, {
    targets: options.targetStore ?? new InMemoryTargetStore(),
    isOwner,
    clock: options.clock,
    timeZone: options.timeZone ?? "UTC",
  });

  return app;
}
