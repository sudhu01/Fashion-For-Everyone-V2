import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ZodError } from "zod";

// Typed errors so route handlers can `throw` and let a single helper render
// the response, instead of repeating status-code branching everywhere.

export class HttpError extends Error {
  status: number;
  expose: string;
  constructor(status: number, expose: string, internal?: string) {
    super(internal ?? expose);
    this.status = status;
    this.expose = expose;
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized.") {
    super(401, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden.") {
    super(403, message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found.") {
    super(404, message);
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Bad request.") {
    super(400, message);
  }
}

export class RateLimitError extends HttpError {
  retryAfter: number;
  constructor(retryAfter: number, message = "Too many requests.") {
    super(429, message);
    this.retryAfter = retryAfter;
  }
}

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  });
}

export function jsonOk(body: unknown, extraHeaders: Record<string, string> = {}) {
  return jsonResponse(200, body, extraHeaders);
}

export function jsonError(
  status: number,
  message: string,
  extraHeaders: Record<string, string> = {}
) {
  return jsonResponse(status, { error: message }, extraHeaders);
}

// Bounded JSON body parser. Reads the request as text with a hard byte
// budget (default 32 KiB — generous for any of our JSON-only routes) before
// JSON.parse, so a malicious client can't DoS the process by streaming a
// 50MB payload into a route that only expects a few hundred bytes.
//
// Routes with larger payloads (uploads, base64) pass an explicit `maxBytes`.
export async function readJson<T = unknown>(
  req: NextRequest,
  maxBytes = 32 * 1024
): Promise<T> {
  const lenHeader = req.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > maxBytes) {
    throw new HttpError(413, "Payload too large.");
  }
  // Stream the body so we can stop as soon as we exceed maxBytes — never
  // trust content-length alone (client can lie / omit it).
  const reader = req.body?.getReader();
  if (!reader) {
    // No body — treat as empty object. Routes use zod to validate.
    return {} as T;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Cap on total bytes read regardless of header.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new HttpError(413, "Payload too large.");
      }
      chunks.push(value);
    }
  }
  if (total === 0) return {} as T;
  // Concatenate efficiently.
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(merged);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

// Single funnel for unhandled errors thrown inside routes. Logs the real
// thing server-side, returns a sanitized message to the client so we never
// leak Prisma stack traces / upstream payloads.
export function handleError(err: unknown) {
  if (err instanceof RateLimitError) {
    return jsonError(err.status, err.expose, {
      "Retry-After": String(err.retryAfter),
    });
  }
  if (err instanceof HttpError) {
    return jsonError(err.status, err.expose);
  }
  if (err instanceof ZodError) {
    return jsonResponse(400, {
      error: "Invalid request body.",
      issues: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  // eslint-disable-next-line no-console
  console.error("[api] unhandled error", err);
  return jsonError(500, "Internal server error.");
}
