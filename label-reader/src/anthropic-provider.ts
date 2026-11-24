import type { LabelProvider, LabelValues } from "./index.js";

// This package builds with `types: []` and no DOM lib, so the two globals it uses are declared here.
declare function fetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: unknown },
): Promise<{ status: number; text(): Promise<string> }>;
declare const AbortSignal: { timeout(ms: number): unknown };

/** The HTTP seam: the same shape as fetch, so a test passes a fake and never makes a real call. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: unknown },
) => Promise<{ status: number; text(): Promise<string> }>;

/** Stable error codes for provider failures (CMP-003 structured_errors). */
export type LabelProviderErrorCode =
  | "provider.config"
  | "provider.photo_type"
  | "provider.timeout"
  | "provider.unreachable"
  | "provider.http"
  | "provider.malformed";

export class LabelProviderError extends Error {
  readonly code: LabelProviderErrorCode;
  constructor(code: LabelProviderErrorCode, message: string) {
    super(message);
    this.name = "LabelProviderError";
    this.code = code;
  }
}

export interface AnthropicLabelProviderOptions {
  /** The provider key. Comes from the environment; never logged. */
  apiKey: string;
  /** Default claude-sonnet-5-5. */
  model?: string;
  /** Default https://api.anthropic.com. A recorded mock can replace it at a process boundary. */
  baseUrl?: string;
  /** Default 30000. One attempt only, no retries. */
  timeoutMs?: number;
  fetchFn?: FetchLike;
  /** Receives the run id and an outcome code only: never the photo, the key or the reply. */
  log?: (message: string) => void;
}

export const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_TIMEOUT_MS = 30000;
const TOOL_NAME = "record_label";

const ALPHABET: string[] = [];
for (let c = 65; c <= 90; c++) ALPHABET.push(String.fromCharCode(c));
for (let c = 97; c <= 122; c++) ALPHABET.push(String.fromCharCode(c));
for (let c = 48; c <= 57; c++) ALPHABET.push(String.fromCharCode(c));
ALPHABET.push(String.fromCharCode(43), String.fromCharCode(47));

/** Standard base64 with padding. */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : "=";
  }
  return out;
}

/** The image type from the leading bytes, or undefined when it is not one the API accepts. */
export function sniffMediaType(b: Uint8Array): string | undefined {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

const TEXT_FIELDS = ["name", "shop", "brand"] as const;
const NUMBER_FIELDS = ["calories", "protein", "fat"] as const;

function fieldSchema(type: string): { type: string[]; description: string } {
  return { type: [type, "null"], description: "null when the label does not show it or it cannot be read" };
}

const TOOL = {
  name: TOOL_NAME,
  description: "Record the values read from a food label photo. Use null for anything not shown or not readable.",
  input_schema: {
    type: "object",
    properties: {
      name: fieldSchema("string"),
      shop: fieldSchema("string"),
      brand: fieldSchema("string"),
      calories: fieldSchema("number"),
      protein: fieldSchema("number"),
      fat: fieldSchema("number"),
    },
    required: ["name", "shop", "brand", "calories", "protein", "fat"],
  },
};

const PROMPT =
  "Read this food label photo. Report calories, protein and fat per 100 g exactly as the label shows them. " +
  "If the label gives only per-serving values, use null for them. " +
  "Report the product name, the shop and the brand only if the label shows them. " +
  "Never guess: use null for anything not shown or not readable.";

function malformed(): LabelProviderError {
  return new LabelProviderError("provider.malformed", "The provider reply is not valid label values.");
}

/** Checks the tool input and builds LabelValues. A wrong type or a missing key is a failure. */
function checkValues(input: unknown): LabelValues {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw malformed();
  const record = input as Record<string, unknown>;
  const values: LabelValues = { name: null, shop: null, calories: null, protein: null, fat: null, brand: null };
  for (const key of TEXT_FIELDS) {
    if (!(key in record)) throw malformed();
    const v = record[key];
    if (v === null) continue;
    if (typeof v !== "string") throw malformed();
    const trimmed = v.trim();
    values[key] = trimmed === "" ? null : trimmed;
  }
  for (const key of NUMBER_FIELDS) {
    if (!(key in record)) throw malformed();
    const v = record[key];
    if (v === null) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw malformed();
    values[key] = v;
  }
  return values;
}

function extractToolInput(text: string): unknown {
  let reply: unknown;
  try {
    reply = JSON.parse(text);
  } catch {
    throw malformed();
  }
  const content = typeof reply === "object" && reply !== null ? (reply as { content?: unknown }).content : undefined;
  if (!Array.isArray(content)) throw malformed();
  for (const block of content) {
    if (typeof block === "object" && block !== null) {
      const b = block as { type?: unknown; name?: unknown; input?: unknown };
      if (b.type === "tool_use" && b.name === TOOL_NAME) return b.input;
    }
  }
  throw malformed();
}

function isTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  const name = (error as { name: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

/** The Claude label reader (ADR-005 a). One request per photo: no retries. */
export function createAnthropicLabelProvider(options: AnthropicLabelProviderOptions): LabelProvider {
  if (typeof options.apiKey !== "string" || options.apiKey.trim() === "") {
    throw new LabelProviderError("provider.config", "The provider key is not set.");
  }
  const apiKey = options.apiKey;
  const model = options.model && options.model !== "" ? options.model : DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const send: FetchLike = options.fetchFn ?? fetch;
  const log = options.log ?? (() => undefined);

  async function read(photo: Uint8Array): Promise<LabelValues> {
    const mediaType = sniffMediaType(photo);
    if (!mediaType) throw new LabelProviderError("provider.photo_type", "The photo is not a supported image type.");
    const body = JSON.stringify({
      model,
      max_tokens: 512,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: toBase64(photo) } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    let response: { status: number; text(): Promise<string> };
    try {
      response = await send(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (isTimeout(error)) throw new LabelProviderError("provider.timeout", "The provider call timed out.");
      throw new LabelProviderError("provider.unreachable", "The provider could not be reached.");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new LabelProviderError("provider.http", `The provider answered status ${response.status}.`);
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (isTimeout(error)) throw new LabelProviderError("provider.timeout", "The provider call timed out.");
      throw new LabelProviderError("provider.unreachable", "The provider reply could not be read.");
    }
    return checkValues(extractToolInput(text));
  }

  return {
    async readLabel(photo: Uint8Array, runId?: string): Promise<LabelValues> {
      const id = runId ?? "none";
      try {
        const values = await read(photo);
        log(`label.read run_id=${id} outcome=ok`);
        return values;
      } catch (error) {
        const code = error instanceof LabelProviderError ? error.code : "provider.unreachable";
        log(`label.read run_id=${id} outcome=${code}`);
        throw error;
      }
    },
  };
}
