import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "./app.js";
import { registerClient } from "./static.js";

let base = "";
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "client-test-"));
  const dist = join(base, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<html>synthetic-index</html>");
  writeFileSync(join(dist, "assets", "app.js"), "console.log('synthetic');");
  writeFileSync(join(base, "outside.txt"), "synthetic-outside-content");
  app = buildApp();
  registerClient(app, dist);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(base, { recursive: true, force: true });
});

// characterization
test("serves index.html at the root", async () => {
  const res = await app.inject({ method: "GET", url: "/" });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toContain("text/html");
  expect(res.body).toContain("synthetic-index");
});

// characterization
test("serves a built asset with its content type", async () => {
  const res = await app.inject({ method: "GET", url: "/assets/app.js" });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toContain("text/javascript");
  expect(res.body).toContain("synthetic");
});

// characterization
test("falls back to index.html for a client route", async () => {
  const res = await app.inject({ method: "GET", url: "/journal/today" });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain("synthetic-index");
});

// characterization
test("answers a missing file with an extension 404", async () => {
  const res = await app.inject({ method: "GET", url: "/assets/missing.js" });
  expect(res.statusCode).toBe(404);
});

// characterization
test("does not serve files outside the client directory", async () => {
  for (const url of ["/%2e%2e/outside.txt", "/..%2foutside.txt", "/assets/%2e%2e/%2e%2e/outside.txt"]) {
    const res = await app.inject({ method: "GET", url });
    expect(res.body).not.toContain("synthetic-outside-content");
  }
});

// cites: IF-001@1.0.0#getReadiness
test("keeps the readiness route ahead of the client fallback", async () => {
  const res = await app.inject({ method: "GET", url: "/readiness" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ready: true });
});

// cites: IF-001@1.0.0#getReadiness
test("never answers an unknown API path with the client", async () => {
  const res = await app.inject({ method: "GET", url: "/products/unknown" });
  expect(res.statusCode).toBe(404);
  expect(res.body).not.toContain("synthetic-index");
});
