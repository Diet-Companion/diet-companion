import { describe, expect, it } from "vitest";
import { createApi, type FetchLike } from "./api";

interface Call {
  url: string;
  init?: RequestInit;
}

function fakeFetch(status: number, body?: unknown) {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fn, calls };
}

const runId = () => "run-test";

const product = {
  id: "p-1",
  name: "Product A",
  shop: "Shop A",
  calories: 120,
  protein: 5,
  fat: 3,
  source: "label",
};

describe("login and logout", () => {
  // cites: REQ-003/AC-010
  it("loginOwner posts the password as JSON and reports ok on 204", async () => {
    const f = fakeFetch(204);
    const result = await createApi(f.fn, runId).loginOwner("test-pass");
    expect(result).toEqual({ kind: "ok" });
    expect(f.calls[0]?.url).toBe("/auth/login");
    expect(f.calls[0]?.init?.method).toBe("POST");
    expect(f.calls[0]?.init?.body).toBe(JSON.stringify({ password: "test-pass" }));
  });

  // cites: REQ-003/AC-010
  it("loginOwner carries the server message on 401", async () => {
    const f = fakeFetch(401, { code: "auth.failed", message: "Wrong password" });
    const result = await createApi(f.fn, runId).loginOwner("x");
    expect(result).toEqual({ kind: "rejected", message: "Wrong password" });
  });

  // cites: REQ-003/AC-010
  it("loginOwner reports failed on a network error", async () => {
    const fn: FetchLike = async () => {
      throw new TypeError("offline");
    };
    expect(await createApi(fn, runId).loginOwner("x")).toEqual({ kind: "failed", message: null });
  });

  // cites: REQ-003/AC-010
  it("logout posts to /auth/logout", async () => {
    const f = fakeFetch(204);
    await createApi(f.fn, runId).logout();
    expect(f.calls[0]?.url).toBe("/auth/logout");
    expect(f.calls[0]?.init?.method).toBe("POST");
  });
});

describe("addProductFromLabelPhoto", () => {
  // cites: REQ-003/AC-010
  it("sends the photo as multipart field photo with the run id and returns the saved product on 201", async () => {
    const f = fakeFetch(201, product);
    const photo = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/jpeg" });
    const result = await createApi(f.fn, runId).addProductFromLabelPhoto(photo);
    expect(result.kind).toBe("saved");
    expect(f.calls[0]?.url).toBe("/products/label-photo");
    const body = f.calls[0]?.init?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).has("photo")).toBe(true);
    expect((f.calls[0]?.init?.headers as Record<string, string>)["X-Run-Id"]).toBe("run-test");
  });

  // cites: REQ-003/AC-002, REQ-003/AC-003, REQ-003/AC-004
  it("returns the missing fields and recognised values on 422", async () => {
    const f = fakeFetch(422, {
      code: "product.values_missing",
      message: "Values missing",
      missing: ["shop", "protein"],
      recognised: { name: "Product A", calories: 120, fat: 3 },
    });
    const result = await createApi(f.fn, runId).addProductFromLabelPhoto(new Blob(["x"]));
    expect(result).toEqual({
      kind: "values_missing",
      missing: ["shop", "protein"],
      recognised: { name: "Product A", calories: 120, fat: 3 },
    });
  });

  // cites: REQ-003/AC-011
  it("returns duplicate with the server message on 409", async () => {
    const f = fakeFetch(409, { code: "product.duplicate_name_shop", message: "Already there" });
    const result = await createApi(f.fn, runId).addProductFromLabelPhoto(new Blob(["x"]));
    expect(result).toEqual({ kind: "duplicate", message: "Already there" });
  });

  // cites: REQ-003/AC-010
  it("returns unauthorized on 401", async () => {
    const f = fakeFetch(401, { code: "auth.required", message: "Log in" });
    const result = await createApi(f.fn, runId).addProductFromLabelPhoto(new Blob(["x"]));
    expect(result).toEqual({ kind: "unauthorized" });
  });

  // cites: REQ-003/AC-010
  it("returns failed for 400, 502 and a network error", async () => {
    for (const status of [400, 502]) {
      const f = fakeFetch(status, { code: "photo.unreadable", message: "Unreadable" });
      const result = await createApi(f.fn, runId).addProductFromLabelPhoto(new Blob(["x"]));
      expect(result).toEqual({ kind: "failed", message: "Unreadable" });
    }
    const fn: FetchLike = async () => {
      throw new TypeError("offline");
    };
    const net = await createApi(fn, runId).addProductFromLabelPhoto(new Blob(["x"]));
    expect(net).toEqual({ kind: "failed", message: null });
  });
});

describe("createProduct", () => {
  const body = { name: "Product A", shop: "Shop A", calories: 120, protein: 5, fat: 3, source: "label" as const };

  // cites: REQ-003/AC-002
  it("posts the product as JSON and returns saved on 201", async () => {
    const f = fakeFetch(201, product);
    const result = await createApi(f.fn, runId).createProduct(body);
    expect(result.kind).toBe("saved");
    expect(f.calls[0]?.url).toBe("/products");
    expect(f.calls[0]?.init?.body).toBe(JSON.stringify(body));
  });

  // cites: REQ-003/AC-012, REQ-003/AC-013
  it("returns duplicate on 409", async () => {
    const f = fakeFetch(409, { code: "product.duplicate_name_shop", message: "Already there" });
    expect(await createApi(f.fn, runId).createProduct(body)).toEqual({
      kind: "duplicate",
      message: "Already there",
    });
  });

  // cites: REQ-003/AC-010
  it("returns unauthorized on 401", async () => {
    const f = fakeFetch(401, { code: "auth.required", message: "Log in" });
    expect(await createApi(f.fn, runId).createProduct(body)).toEqual({ kind: "unauthorized" });
  });
});
