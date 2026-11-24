import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyPassword } from "./password.js";
import type { SessionStore, ThrottleState, ThrottleStore } from "./stores.js";

/** The cookie name from IF-001@1.0.0 security scheme ownerSession. */
export const SESSION_COOKIE = "owner_session";

/** Assumption A-001: a session lasts 7 days from login, with no sliding renewal. */
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Assumption A-002: 5 failed logins within 15 minutes block further attempts until the window ends. */
export const DEFAULT_THROTTLE = { maxFailures: 5, windowMs: 15 * 60 * 1000 };

/** One Owner, so one throttle key. */
const THROTTLE_KEY = "owner";

export interface AuthDeps {
  sessions: SessionStore;
  throttle: ThrottleStore;
  /** Salted scrypt hash (OWNER_PASSWORD_HASH). Absent: every login fails. */
  passwordHash?: string | undefined;
  now?: () => number;
  newSessionId?: () => string;
  sessionTtlMs?: number;
  maxFailures?: number;
  windowMs?: number;
}

export interface Auth {
  /** True when the request carries a valid, unexpired Owner session (ADR-004/C-005). */
  isOwner(request: FastifyRequest): Promise<boolean>;
  /** IF-001@1.0.0 loginOwner and logout. */
  registerRoutes(app: FastifyInstance): void;
}

/** Only this hash of the cookie value is stored (ADR-004/C-007). */
export function sessionKey(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

function readSessionId(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;
  if (typeof header !== "string") return undefined;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    if (part.slice(0, at).trim() === SESSION_COOKIE) {
      const value = part.slice(at + 1).trim();
      return value === "" ? undefined : value;
    }
  }
  return undefined;
}

function cookie(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

function sendAuthError(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  const runId = request.headers["x-run-id"];
  return reply.code(status).send({ code, message, ...(typeof runId === "string" ? { run_id: runId } : {}) });
}

export function createAuth(deps: AuthDeps): Auth {
  const now = deps.now ?? Date.now;
  const newSessionId = deps.newSessionId ?? ((): string => randomBytes(32).toString("base64url"));
  const ttl = deps.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const maxFailures = deps.maxFailures ?? DEFAULT_THROTTLE.maxFailures;
  const windowMs = deps.windowMs ?? DEFAULT_THROTTLE.windowMs;

  const isBlocked = (state: ThrottleState | undefined): boolean =>
    state !== undefined && state.failures >= maxFailures && state.windowStart > now() - windowMs;

  async function isOwner(request: FastifyRequest): Promise<boolean> {
    const id = readSessionId(request);
    if (id === undefined) return false;
    const key = sessionKey(id);
    const expiresAt = await deps.sessions.findExpiry(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now()) {
      await deps.sessions.delete(key);
      return false;
    }
    return true;
  }

  function registerRoutes(app: FastifyInstance): void {
    // IF-001@1.0.0 loginOwner
    app.post("/auth/login", async (request, reply) => {
      if (isBlocked(await deps.throttle.get(THROTTLE_KEY))) {
        return sendAuthError(request, reply, 429, "auth.throttled", "Too many failed attempts. Try again later.");
      }
      const body: unknown = request.body;
      const password =
        typeof body === "object" && body !== null ? (body as Record<string, unknown>).password : undefined;
      const ok =
        typeof password === "string" &&
        password !== "" &&
        deps.passwordHash !== undefined &&
        (await verifyPassword(password, deps.passwordHash));
      if (!ok) {
        await deps.throttle.recordFailure(THROTTLE_KEY, now(), windowMs);
        return sendAuthError(request, reply, 401, "auth.failed", "Sign-in failed.");
      }
      await deps.throttle.clear(THROTTLE_KEY);
      const id = newSessionId();
      await deps.sessions.create(sessionKey(id), now() + ttl);
      void reply.header("Set-Cookie", cookie(id, Math.floor(ttl / 1000)));
      return reply.code(204).send();
    });

    // IF-001@1.0.0 logout
    app.post("/auth/logout", async (request, reply) => {
      if (!(await isOwner(request))) {
        return sendAuthError(request, reply, 401, "auth.required", "No valid Owner session.");
      }
      const id = readSessionId(request);
      if (id !== undefined) await deps.sessions.delete(sessionKey(id));
      void reply.header("Set-Cookie", cookie("", 0));
      return reply.code(204).send();
    });
  }

  return { isOwner, registerRoutes };
}
