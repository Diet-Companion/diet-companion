import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

/** IF-001 paths keep precedence: unmatched requests under these prefixes are never answered with the client. */
const API_PREFIXES = ["/products", "/auth", "/readiness"];

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function isApiPath(path: string): boolean {
  return API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** The file for urlPath inside root, or undefined when it is missing, not a file or outside root. */
async function fileIn(root: string, urlPath: string): Promise<string | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const target = resolve(root, `.${decoded}`);
  if (target !== root && !target.startsWith(root + sep)) return undefined;
  try {
    const info = await stat(target);
    return info.isFile() ? target : undefined;
  } catch {
    return undefined;
  }
}

function sendFile(reply: FastifyReply, file: string, cache: string): FastifyReply {
  void reply.header("Cache-Control", cache);
  return reply.type(TYPES[extname(file).toLowerCase()] ?? "application/octet-stream").send(createReadStream(file));
}

function sendNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ code: "not_found", message: "Not found." });
}

/**
 * Serves the built client from dir at / with an SPA fallback to index.html for extensionless GET and HEAD
 * paths. Registered routes always win, because this is only the not-found handler.
 */
export function registerClient(app: FastifyInstance, dir: string): void {
  const root = resolve(dir);
  app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split("?")[0] ?? "/";
    const readOnly = request.method === "GET" || request.method === "HEAD";
    if (!readOnly || isApiPath(path)) return sendNotFound(reply);
    const file = await fileIn(root, path);
    if (file !== undefined) {
      const cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
      return sendFile(reply, file, cache);
    }
    if (extname(path) !== "") return sendNotFound(reply);
    const index = await fileIn(root, "/index.html");
    if (index === undefined) return sendNotFound(reply);
    return sendFile(reply, index, "no-cache");
  });
}
