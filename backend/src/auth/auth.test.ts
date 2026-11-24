import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { sessionKey } from "./auth.js";
import { hashPassword } from "./password.js";
import { InMemorySessionStore, InMemoryThrottleStore } from "./stores.js";

const PASSWORD = "synthetic-test-password";
const PRODUCT = { name: "Product A", shop: "Shop A", calories: 100, protein: 5, fat: 2, source: "manual" };
const T0 = 1_000_000;

let hash: string;
beforeAll(async () => {
  hash = await hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 });
});

function setup(overrides: { passwordHash?: string | undefined; maxFailures?: number; windowMs?: number } = {}) {
  const sessions = new InMemorySessionStore();
  const throttle = new InMemoryThrottleStore();
  const clock = { t: T0 };
  let n = 0;
  const app = buildApp({
    auth: {
      sessions,
      throttle,
      passwordHash: "passwordHash" in overrides ? overrides.passwordHash : hash,
      now: () => clock.t,
      newSessionId: () => `session-id-${++n}`,
      sessionTtlMs: 60_000,
      maxFailures: overrides.maxFailures ?? 3,
      windowMs: overrides.windowMs ?? 10_000,
    },
  });
  const login = (password: unknown) =>
    app.inject({ method: "POST", url: "/auth/login", payload: { password } });
  return { app, sessions, throttle, clock, login };
}

const asOwner = (id: string) => ({ cookie: `owner_session=${id}` });

describe("loginOwner", () => {
  // cites: IF-001@1.0.0#loginOwner
  it("answers 204 and sets an HttpOnly Secure SameSite=Strict cookie with only an opaque id", async () => {
    const { login, sessions } = setup();
    const res = await login(PASSWORD);
    expect(res.statusCode).toBe(204);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toContain("owner_session=session-id-1;");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    expect(sessions.size()).toBe(1);
    expect(await sessions.findExpiry(sessionKey("session-id-1"))).toBe(T0 + 60_000);
    expect(res.body).not.toContain(PASSWORD);
  });

  // cites: IF-001@1.0.0#loginOwner
  it("answers the same 401 auth.failed whatever the cause", async () => {
    const wrong = await setup().login("not-the-password");
    const missing = await setup().login(undefined);
    const noHash = await setup({ passwordHash: undefined }).login(PASSWORD);
    for (const res of [wrong, missing, noHash]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ code: "auth.failed", message: "Sign-in failed." });
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });

  // cites: IF-001@1.0.0#loginOwner
  it("answers 429 auth.throttled after too many failures, even for the right password", async () => {
    const { login } = setup({ maxFailures: 3 });
    for (let i = 0; i < 3; i++) expect((await login("wrong")).statusCode).toBe(401);
    const res = await login(PASSWORD);
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe("auth.throttled");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  // cites: IF-001@1.0.0#loginOwner
  it("allows a login again when the throttle window has passed", async () => {
    const { login, clock } = setup({ maxFailures: 2, windowMs: 10_000 });
    await login("wrong");
    await login("wrong");
    expect((await login(PASSWORD)).statusCode).toBe(429);
    clock.t += 10_001;
    expect((await login(PASSWORD)).statusCode).toBe(204);
  });

  // cites: IF-001@1.0.0#loginOwner
  it("clears the failure count after a successful login", async () => {
    const { login } = setup({ maxFailures: 3 });
    await login("wrong");
    await login("wrong");
    expect((await login(PASSWORD)).statusCode).toBe(204);
    await login("wrong");
    await login("wrong");
    expect((await login(PASSWORD)).statusCode).toBe(204);
  });
});

describe("Owner session check", () => {
  // cites: IF-001@1.0.0#createProduct
  it("refuses a product request without a session with 401 auth.required", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "POST", url: "/products", payload: PRODUCT });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("auth.required");
  });

  // cites: IF-001@1.0.0#createProduct
  it("refuses an unknown session id", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/products",
      headers: asOwner("never-issued"),
      payload: PRODUCT,
    });
    expect(res.statusCode).toBe(401);
  });

  // cites: IF-001@1.0.0#createProduct
  it("accepts a product request with the session issued by login", async () => {
    const { app, login } = setup();
    await login(PASSWORD);
    const res = await app.inject({
      method: "POST",
      url: "/products",
      headers: asOwner("session-id-1"),
      payload: PRODUCT,
    });
    expect(res.statusCode).toBe(201);
  });

  // cites: IF-001@1.0.0#createProduct
  it("refuses an expired session and removes its row", async () => {
    const { app, login, clock, sessions } = setup();
    await login(PASSWORD);
    clock.t += 60_000;
    const res = await app.inject({
      method: "POST",
      url: "/products",
      headers: asOwner("session-id-1"),
      payload: PRODUCT,
    });
    expect(res.statusCode).toBe(401);
    expect(sessions.size()).toBe(0);
  });

  // cites: IF-001@1.0.0#addProductFromLabelPhoto
  it("refuses the label photo operation without a session", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "POST", url: "/products/label-photo" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("auth.required");
  });

  // cites: IF-001@1.0.0#createProduct
  it("refuses every product request when no auth is configured (fail closed)", async () => {
    const res = await buildApp().inject({ method: "POST", url: "/products", payload: PRODUCT });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("auth.required");
  });

  // cites: IF-001@1.0.0#getReadiness
  it("leaves getReadiness open without a session", async () => {
    const res = await setup().app.inject({ method: "GET", url: "/readiness" });
    expect(res.statusCode).toBe(200);
  });
});

describe("logout", () => {
  // cites: IF-001@1.0.0#logout
  it("deletes the session row, clears the cookie and refuses the session afterwards", async () => {
    const { app, login, sessions } = setup();
    await login(PASSWORD);
    const out = await app.inject({ method: "POST", url: "/auth/logout", headers: asOwner("session-id-1") });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers["set-cookie"])).toContain("Max-Age=0");
    expect(sessions.size()).toBe(0);
    const after = await app.inject({
      method: "POST",
      url: "/products",
      headers: asOwner("session-id-1"),
      payload: PRODUCT,
    });
    expect(after.statusCode).toBe(401);
  });

  // cites: IF-001@1.0.0#logout
  it("answers 401 auth.required without a session", async () => {
    const res = await setup().app.inject({ method: "POST", url: "/auth/logout" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("auth.required");
  });
});
