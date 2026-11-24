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

interface Call {
  url: string;
  init: Parameters<FetchLike>[1];
}

function fakeFetch(replyText: string, status = 200): { fetchFn: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { status, text: async () => replyText };
  };
  return { fetchFn, calls };
}

function toolReply(input: unknown): string {
  return JSON.stringify({ content: [{ type: "tool_use", name: "record_label", input }] });
}

const FULL = { name: "Product A", shop: "Shop A", brand: "Brand A", calories: 120, protein: 7.5, fat: 3 };

async function readWith(input: unknown) {
  const { fetchFn } = fakeFetch(toolReply(input));
  return createAnthropicLabelProvider({ apiKey: TEST_KEY, fetchFn }).readLabel(PNG);
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
  it("sends one forced tool call with the image, the key header and the default model", async () => {
    const { fetchFn, calls } = fakeFetch(toolReply(FULL));
    await createAnthropicLabelProvider({ apiKey: TEST_KEY, fetchFn }).readLabel(PNG);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].init.headers["x-api-key"]).toBe(TEST_KEY);
    expect(calls[0].init.signal).toBeDefined();
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.tool_choice).toEqual({ type: "tool", name: "record_label" });
    const image = body.messages[0].content[0];
    expect(image.source.media_type).toBe("image/png");
    expect(image.source.data).toBe("iVBORw0K");
  });

  it("uses the configured model and base URL", async () => {
    const { fetchFn, calls } = fakeFetch(toolReply(FULL));
    await createAnthropicLabelProvider({
      apiKey: TEST_KEY,
      model: "other-model",
      baseUrl: "http://localhost:9/",
      fetchFn,
    }).readLabel(PNG);
    expect(calls[0].url).toBe("http://localhost:9/v1/messages");
    expect(JSON.parse(calls[0].init.body).model).toBe("other-model");
  });

  it("treats a malformed reply as a provider failure", async () => {
    const bad: string[] = [
      "not json",
      JSON.stringify({ content: [] }),
      JSON.stringify({ content: [{ type: "text", text: "hello" }] }),
      toolReply("text"),
      toolReply({ name: "A" }),
      toolReply({ ...FULL, calories: "120" }),
      toolReply({ ...FULL, fat: -1 }),
      toolReply({ ...FULL, shop: 5 }),
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
    const { fetchFn, calls } = fakeFetch(toolReply(FULL));
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
    const { fetchFn } = fakeFetch(toolReply(FULL));
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
      "label.read run_id=run-2 outcome=provider.http",
    ]);
    expect(lines.join("")).not.toContain(TEST_KEY);
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
