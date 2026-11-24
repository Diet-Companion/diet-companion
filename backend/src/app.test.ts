import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("GET /readiness", () => {
  // cites: IF-001@1.0.0#getReadiness
  it("returns 200 with ready true when every configured check passes", async () => {
    const app = buildApp({
      checks: { database: () => true, label_reader: async () => true },
    });
    const res = await app.inject({ method: "GET", url: "/readiness" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ready: true, database: true, label_reader: true });
  });

  // cites: IF-001@1.0.0#getReadiness
  it("returns 503 with ready false when the database is unreachable", async () => {
    const app = buildApp({
      checks: { database: () => false, label_reader: () => true },
    });
    const res = await app.inject({ method: "GET", url: "/readiness" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ready: false, database: false, label_reader: true });
  });

  // cites: IF-001@1.0.0#getReadiness
  it("returns 503 when the label reader check throws", async () => {
    const app = buildApp({
      checks: {
        label_reader: () => {
          throw new Error("unreachable");
        },
      },
    });
    const res = await app.inject({ method: "GET", url: "/readiness" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ready: false, label_reader: false });
  });

  // characterization: IF-001 does not define the no-checks case (A-001)
  it("returns 200 with ready true when no checks are configured", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/readiness" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ready: true });
  });

  // cites: IF-001@1.0.0#getReadiness
  it("echoes the X-Run-Id header", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/readiness",
      headers: { "x-run-id": "run-test-1" },
    });
    expect(res.headers["x-run-id"]).toBe("run-test-1");
  });
});
