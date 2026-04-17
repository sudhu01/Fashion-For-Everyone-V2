import { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth";
import {
  handleError,
  jsonError,
  jsonOk,
  RateLimitError,
} from "@/lib/errors";
import { generateImage, GenerationError } from "@/lib/generation";
import { createLogger } from "@/lib/logger";
import { take } from "@/lib/rateLimit";
import { generateBodySchema } from "@/lib/validators";

const log = createLogger("api.generate");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Legacy single-shot generate endpoint. Kept around so the existing
// localStorage-backed UI keeps working through the migration. Now requires
// auth and persists the Prompt + GeneratedImage rows via lib/generation.
//
// New code should call POST /api/chats/[id]/messages instead so the result
// is tied to a chat history.

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(req: NextRequest) {
  try {
    // 1. Origin guard (defense in depth on top of Clerk auth).
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return jsonError(403, "Origin not allowed.");
        }
      } catch {
        return jsonError(400, "Invalid origin header.");
      }
    }

    // 2. Content-type guard.
    const ctype = req.headers.get("content-type") ?? "";
    if (!ctype.toLowerCase().includes("application/json")) {
      return jsonError(415, "Content-Type must be application/json.");
    }

    // 3. Size guard.
    const lenHeader = req.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
      return jsonError(413, "Payload too large.");
    }

    // 4. Auth — keys subsequent rate limit + persistence by userId.
    const { userId } = await requireAuth();

    // 5. Per-user rate limit (replaces the legacy IP-keyed bucket now that
    //    auth is mandatory; lib/rateLimit still works the same way).
    // NOTE (pre-prod): in-memory bucket; swap to Redis when scaling out.
    // TODO(pre-prod): enforce creditsBalance / monthlyQuota — see comment
    // in /api/chats/[id]/messages. This route shares the same fal.ai cost.
    const rl = take(`user:${userId}`);
    if (!rl.ok) throw new RateLimitError(rl.retryAfter);

    // 6. Parse + validate body.
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return jsonError(413, "Payload too large.");
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonError(400, "Invalid JSON.");
    }
    const { prompt } = generateBodySchema.parse(body);

    log.info("request", { userId, promptLen: prompt.length });

    // 7. Generate (persisted). messageId is intentionally absent — this
    //    endpoint is chat-less; the Prompt row is recorded standalone.
    const { imageUrl, image } = await generateImage({ userId, prompt });

    log.info("response_ok", { userId, imageId: image.id });
    return jsonOk({ imageUrl, generatedImageId: image.id });
  } catch (err) {
    if (err instanceof GenerationError) {
      log.warn("generation_error", { status: err.status, expose: err.expose, message: err.message });
      return jsonError(err.status, err.expose);
    }
    log.error("unhandled", { err });
    return handleError(err);
  }
}
