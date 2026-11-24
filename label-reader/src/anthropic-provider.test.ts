import { describe, expect, it } from "vitest";
import {
  LabelProviderError,
  createAnthropicLabelProvider,
  sniffMediaType,
  toBase64,
  type FetchLike,
} from "./anthropic-provider.js";

// Synthetic image bytes built in code: only the leading signature matters to the provider.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const TEST_KEY = "test-key";
const SECRET_MESSAGE = "credit balance is too low for this account";

interface Call {
  url: string;
  init: Parameters<FetchLike>[1];
}

function fakeFetch(
  replyText: string,
  status = 200,
  headers?: Record<string, string>,
): { fetchFn: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      status,
      text: async () => replyText,
      headers: headers ? { get: (name: string) => headers[name.toLowerCase()] ?? null } : undefined,
    };
  };
  return { fetchFn, calls };
}

/** A structured-output reply: one text block holding the JSON, stopped at end_turn. */
function textReply(input: unknown, stopReason = "end_turn"): string {
  return JSON.stringify({
    stop_reason: stopReason,
    content: [{ type: "text", text: JSON.stringify(input) }],
  });
}

const FULL = { name: "Product A", shop: "Shop A", brand: "Brand A", calories: 120, protein: 7.5, fat: 3 };

async function readWith(input: unknown) {
  const { fetchFn } = fakeFetch(textReply(input));
  return createAnthropicLabelProvider({ apiKey: TEST_KEY, fetchFn }).readLabel(PNG);
}

/** Runs a failing read and returns the log lines and the thrown error. */
async function failWith(replyText: string, status: number, headers?: Record<string, string>) {
  const lines: string[] = [];
  const provider = createAnthropicLabelProvider({
    apiKey: TEST_KEY,
    fetchFn: fakeFetch(replyText, status, headers).fetchFn,
    log: (m) => lines.push(m),
  });
  let error: unknown;
  try {
    await provider.readLabel(PNG);
  } catch (e) {
    error = e;
  }
  return { lines, error };
}

/** Every key name used anywhere in a JSON value. */
function allKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, out);
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

describe("anthropic label provider", () => {
  // cites: REQ-003/AC-010
  it("returns every value the label shows, per 100 g", async () => {
    expect(await readWith(FULL)).toEqual({
      name: "Product A",
      shop: "Shop A",
      brand: "Brand A",
      calories: 120,
      protein: 7.5,
      fat: 3,
    });
  });

  // cites: REQ-003/AC-002
  it("returns shop null when the label shows no shop", async () => {
    const values = await readWith({ ...FULL, shop: null });
    expect(values.shop).toBeNull();
    expect(values.name).toBe("Product A");
  });

  // cites: REQ-003/AC-003
  it("returns protein null when protein cannot be read", async () => {
    expect((await readWith({ ...FULL, protein: null })).protein).toBeNull();
  });

  // cites: REQ-003/AC-004
  it("returns name null when the label gives no name, also for a blank name", async () => {
    expect((await readWith({ ...FULL, name: null })).name).toBeNull();
    expect((await readWith({ ...FULL, name: "   " })).name).toBeNull();
  });

  // cites: REQ-003/AC-007
  it("returns calories null when calories cannot be read", async () => {
    expect((await readWith({ ...FULL, calories: null })).calories).toBeNull();
  });

  // cites: REQ-003/AC-008
  it("returns fat null when fat cannot be read", async () => {
    expect((await readWith({ ...FULL, fat: null })).fat).toBeNull();
  });

  // cites: REQ-003/AC-010, ADR-005/C-001
  it("sends one structured-output request with the image, the key header and the default model", async () => {
    const { fetchFn, calls } = fakeFetch(textReply(FULL));
    await createAnthropicLabelProvider({ apiKey: TEST_KEY, fetchFn }).readLabel(PNG);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].init.headers["x-api-key"]).toBe(TEST_KEY);
    expect(calls[0].init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(calls[0].init.signal).toBeDefined();
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe("claude-sonnet-5-5");
    const image = body.messages[0].content[0];
    expect(image.source.media_type).toBe("image/png");
    expect(image.source.data).toBe("iVBORw0K");
  });

  // cites: REQ-003/AC-010, ADR-005/C-001
  it("asks for json_schema output and sends no tools, no tool_choice and no sampling parameters", async () => {
    const { fetchFn, calls } = fakeFetch(textReply(FULL));
    await createAnthropicLabelProvider({ apiKey: TEST_KEY, fetchFn }).readLabel(PNG);
    const body = JSON.parse(calls[0].init.body);
    expect(body.output_config.format.type).toBe("json_schema");
    const schema = body.output_config.format.schema;
    expect(schema.additionalProperties).toBe(false);
    const keys = allKeys(schema);
    for (const banned of ["minimum", "maximum", "minLength", "maxLength"]) {
      expect(keys.has(banned)).toBe(false);
    }
    expect(body.thinking).toEqual({ type: "between_tools" });
    expect(body.max_tokens).toBe(1024);
    for (const absent of ["tools", "tool_choice", "temperature", "top_p", "top_k"]) {
      expect(absent in body).toBe(false);
    }
  });

  // cites: REQ-003/AC-010
  it("parses the text block, also when a thinking block comes first", async () => {
    const reply = JSON.stringify({
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "reading the label" },
        { type: "text", text: JSON.stringify(FULL) },
      ],
    });
    const { fetchFn } = fakeFetch(reply);
    const values = await createAnthropicLabelProvider({ apiKey: TEST_KEY, fetchFn }).readLabel(PNG);
    expect(values).toEqual(FULL);
  });

  it("uses the configured model and base URL", async () => {
    const { fetchFn, calls } = fakeFetch(textReply(FULL));
    await createAnthropicLabelProvider({
      apiKey: TEST_KEY,
      model: "other-model",
      baseUrl: "http://localhost:9/",
      fetchFn,
    }).readLabel(PNG);
    expect(calls[0].url).toBe("http://localhost:9/v1/messages");
    expect(JSON.parse(calls[0].init.body).model).toBe("other-model");
  });

  // cites: REQ-003/AC-010
  it("treats a malformed reply as a provider failure", async () => {
    const bad: string[] = [
      "not json",
      JSON.stringify({ stop_reason: "end_turn", content: [] }),
      JSON.stringify({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "only" }] }),
      JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }),
      textReply(FULL, "max_tokens"),
      JSON.stringify({ content: [{ type: "text", text: JSON.stringify(FULL) }] }),
      textReply("text"),
      textReply({ name: "A" }),
      textReply({ ...FULL, calories: "120" }),
      textReply({ ...FULL, fat: -1 }),
      textReply({ ...FULL, shop: 5 }),
    ];
    for (const text of bad) {
      const { fetchFn } = fakeFetch(text);
      const provider = createAnthropicLabelProvider({ apiKey: TEST_KEY, fetchFn });
      await expect(provider.readLabel(PNG)).rejects.toMatchObject({ code: "provider.malformed" });
    }
  });

  it("fails on a non-success status without retrying", async () => {
    const { fetchFn, calls } = fakeFetch("{}", 529);
    const provider = createAnthropicLabelProvider({ apiKey: TEST_KEY, fetchFn });
    await expect(provider.readLabel(PNG)).rejects.toMatchObject({ code: "provider.http" });
    expect(calls).toHaveLength(1);
  });

  it("maps a timeout and a network error to stable codes", async () => {
    const timeout: FetchLike = async () => {
      throw { name: "TimeoutError" };
    };
    const down: FetchLike = async () => {
      throw new Error("connection refused");
    };
    await expect(
      createAnthropicLabelProvider({ apiKey: TEST_KEY, fetchFn: timeout }).readLabel(PNG),
    ).rejects.toMatchObject({ code: "provider.timeout" });
    await expect(
      createAnthropicLabelProvider({ apiKey: TEST_KEY, fetchFn: down }).readLabel(PNG),
    ).rejects.toMatchObject({ code: "provider.unreachable" });
  });

  it("refuses a photo that is not a supported image without calling the provider", async () => {
    const { fetchFn, calls } = fakeFetch(textReply(FULL));
    const provider = createAnthropicLabelProvider({ apiKey: TEST_KEY, fetchFn });
    await expect(provider.readLabel(new Uint8Array(16))).rejects.toMatchObject({ code: "provider.photo_type" });
    expect(calls).toHaveLength(0);
  });

  it("refuses to start without a key", () => {
    expect(() => createAnthropicLabelProvider({ apiKey: " " })).toThrow(LabelProviderError);
  });

  // cites: ADR-005/C-001, ADR-005/C-002
  it("logs only the run id and the outcome, never the key or the photo", async () => {
    const lines: string[] = [];
    const { fetchFn } = fakeFetch(textReply(FULL));
    const ok = createAnthropicLabelProvider({ apiKey: TEST_KEY, fetchFn, log: (m) => lines.push(m) });
    await ok.readLabel(PNG, "run-1");
    const failing = createAnthropicLabelProvider({
      apiKey: TEST_KEY,
      fetchFn: fakeFetch("{}", 500).fetchFn,
      log: (m) => lines.push(m),
    });
    await expect(failing.readLabel(PNG, "run-2")).rejects.toBeInstanceOf(LabelProviderError);
    expect(lines).toEqual([
      "label.read run_id=run-1 outcome=ok",
      "label.read run_id=run-2 outcome=provider.http status=500",
    ]);
    expect(lines.join("")).not.toContain(TEST_KEY);
  });

  // cites: ADR-005/C-001, ADR-005/C-002, Diet-Companion/diet-companion#64
  it("logs status, error type and request id of a 400 with a JSON error body, never the message", async () => {
    const body = JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: SECRET_MESSAGE },
      request_id: "req_test1",
    });
    const { lines, error } = await failWith(body, 400);
    expect(lines).toEqual([
      "label.read run_id=none outcome=provider.http status=400 error_type=invalid_request_error provider_request_id=req_test1",
    ]);
    expect(lines.join("")).not.toContain(SECRET_MESSAGE);
    expect(lines.join("")).not.toContain(TEST_KEY);
    expect(error).toMatchObject({
      code: "provider.http",
      detail: { status: 400, errorType: "invalid_request_error", requestId: "req_test1" },
    });
    expect(String((error as Error).message)).not.toContain(SECRET_MESSAGE);
  });

  // cites: ADR-005/C-001, ADR-005/C-002, Diet-Companion/diet-companion#64
  it("logs a 401 with the request id taken from the request-id header", async () => {
    const body = JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: SECRET_MESSAGE },
    });
    const { lines } = await failWith(body, 401, { "request-id": "req_hdr1" });
    expect(lines).toEqual([
      "label.read run_id=none outcome=provider.http status=401 error_type=authentication_error provider_request_id=req_hdr1",
    ]);
    expect(lines.join("")).not.toContain(SECRET_MESSAGE);
  });

  // cites: ADR-005/C-001, ADR-005/C-002, Diet-Companion/diet-companion#64
  it("still logs the status when the error body is not JSON, and drops unsafe values", async () => {
    const plain = await failWith(`upstream says: ${SECRET_MESSAGE}`, 502);
    expect(plain.lines).toEqual(["label.read run_id=none outcome=provider.http status=502"]);
    expect(plain.lines.join("")).not.toContain(SECRET_MESSAGE);
    const unsafe = JSON.stringify({ error: { type: "bad type with spaces" }, request_id: 7 });
    const odd = await failWith(unsafe, 429);
    expect(odd.lines).toEqual(["label.read run_id=none outcome=provider.http status=429"]);
  });

  it("encodes base64 with padding and recognises image types", () => {
    expect(toBase64(Uint8Array.from([0x4d, 0x61, 0x6e]))).toBe("TWFu");
    expect(toBase64(Uint8Array.from([0x4d, 0x61]))).toBe("TWE=");
    expect(toBase64(Uint8Array.from([0x4d]))).toBe("TQ==");
    expect(sniffMediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMediaType(Uint8Array.from([0x47, 0x49, 0x46, 0x38]))).toBe("image/gif");
    expect(
      sniffMediaType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe("image/webp");
    expect(sniffMediaType(new Uint8Array(4))).toBeUndefined();
  });
});
