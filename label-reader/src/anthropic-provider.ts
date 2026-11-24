import type { LabelProvider, LabelValues } from "./index.js";

// This package builds with `types: []` and no DOM lib, so the two globals it uses are declared here.
declare function fetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: unknown },
): Promise<FetchResponse>;
declare const AbortSignal: { timeout(ms: number): unknown };

/** The part of a fetch response this package uses. `headers` is optional so a simple fake can omit it. */
export interface FetchResponse {
  status: number;
  text(): Promise<string>;
  headers?: { get(name: string): string | null };
}

/** The HTTP seam: the same shape as fetch, so a test passes a fake and never makes a real call. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: unknown },
) => Promise<FetchResponse>;

/** Stable error codes for provider failures (CMP-003 structured_errors). */
export type LabelProviderErrorCode =
  | "provider.config"
  | "provider.photo_type"
  | "provider.timeout"
  | "provider.unreachable"
  | "provider.http"
  | "provider.malformed";

/** What a non-2xx provider answer tells us. Never holds the provider's free-text message. */
export interface ProviderHttpDetail {
  status: number;
  errorType?: string;
  requestId?: string;
}

export class LabelProviderError extends Error {
  readonly code: LabelProviderErrorCode;
  readonly detail?: ProviderHttpDetail;
  constructor(code: LabelProviderErrorCode, message: string, detail?: ProviderHttpDetail) {
    super(message);
    this.name = "LabelProviderError";
    this.code = code;
    this.detail = detail;
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
  /**
   * Receives the run id, an outcome code and, for an HTTP failure, the status, error type and request id:
   * never the photo, the key, the request body or the provider's message.
   */
  log?: (message: string) => void;
}

export const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TOKENS = 1024;

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

/**
 * The structured-output schema. The API rejects minimum, maximum, minLength and maxLength here,
 * so the >= 0 and non-empty checks stay in checkValues after parsing.
 */
const LABEL_SCHEMA = {
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
  additionalProperties: false,
};

const PROMPT =
  "Read this food label photo. Report calories, protein and fat per 100 g exactly as the label shows them. " +
  "If the label gives only per-serving values, use null for them. " +
  "Report the product name, the shop and the brand only if the label shows them. " +
  "Never guess: use null for anything not shown or not readable.";

function malformed(): LabelProviderError {
  return new LabelProviderError("provider.malformed", "The provider reply is not valid label values.");
}

/** Logged tokens must be short and made of safe characters, so free text can never reach the log. */
function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : undefined;
}

/** Reads the status, the error type and the request id of a non-2xx answer. Never throws, never keeps the message. */
async function httpDetail(response: FetchResponse): Promise<ProviderHttpDetail> {
  const detail: ProviderHttpDetail = { status: response.status };
  let requestId: string | undefined;
  try {
    requestId = safeToken(response.headers?.get("request-id"));
  } catch {
    requestId = undefined;
  }
  try {
    const parsed: unknown = JSON.parse(await response.text());
    if (typeof parsed === "object" && parsed !== null) {
      const body = parsed as { error?: unknown; request_id?: unknown };
      if (typeof body.error === "object" && body.error !== null) {
        detail.errorType = safeToken((body.error as { type?: unknown }).type);
      }
      requestId = safeToken(body.request_id) ?? requestId;
    }
  } catch {
    // A missing, unreadable or non-JSON body still reports the status.
  }
  if (requestId !== undefined) detail.requestId = requestId;
  return detail;
}

/** Checks the parsed reply and builds LabelValues. A wrong type or a missing key is a failure. */
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

/**
 * Finds the JSON the model wrote. The reply must have stopped at end_turn (max_tokens may have cut
 * the JSON off), and the answer is the first text block: a thinking block can come first.
 */
function extractLabelJson(text: string): unknown {
  let reply: unknown;
  try {
    reply = JSON.parse(text);
  } catch {
    throw malformed();
  }
  if (typeof reply !== "object" || reply === null) throw malformed();
  const { content, stop_reason: stopReason } = reply as { content?: unknown; stop_reason?: unknown };
  if (stopReason !== "end_turn" || !Array.isArray(content)) throw malformed();
  for (const block of content) {
    if (typeof block === "object" && block !== null) {
      const b = block as { type?: unknown; text?: unknown };
      if (b.type === "text") {
        if (typeof b.text !== "string") throw malformed();
        try {
          return JSON.parse(b.text);
        } catch {
          throw malformed();
        }
      }
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
    // Structured output, not forced tool use: this model family answers a forced tool_choice with a 400.
    // No temperature, top_p or top_k, and no thinking type "disabled": all of them are a 400 here.
    const body = JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      thinking: { type: "between_tools" },
      output_config: { format: { type: "json_schema", schema: LABEL_SCHEMA } },
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
    let response: FetchResponse;
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
      const detail = await httpDetail(response);
      throw new LabelProviderError("provider.http", `The provider answered status ${response.status}.`, detail);
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (isTimeout(error)) throw new LabelProviderError("provider.timeout", "The provider call timed out.");
      throw new LabelProviderError("provider.unreachable", "The provider reply could not be read.");
    }
    return checkValues(extractLabelJson(text));
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
        let line = `label.read run_id=${id} outcome=${code}`;
        const detail = error instanceof LabelProviderError ? error.detail : undefined;
        if (detail) {
          line += ` status=${detail.status}`;
          if (detail.errorType) line += ` error_type=${detail.errorType}`;
          if (detail.requestId) line += ` provider_request_id=${detail.requestId}`;
        }
        log(line);
        throw error;
      }
    },
  };
}
