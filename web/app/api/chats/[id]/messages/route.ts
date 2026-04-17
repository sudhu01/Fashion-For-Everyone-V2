import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  handleError,
  jsonOk,
  NotFoundError,
  RateLimitError,
  readJson,
} from "@/lib/errors";
import { generateImage, GenerationError } from "@/lib/generation";
import { createLogger } from "@/lib/logger";
import { take } from "@/lib/rateLimit";
import { postMessageSchema } from "@/lib/validators";

const log = createLogger("api.chat.messages");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

interface Ctx {
  params: { id: string };
}

// GET /api/chats/[id]/messages — list messages for a chat (ownership-checked).
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await requireAuth();
    const chatId = idSchema.parse(params.id);

    const chat = await prisma.chat.findFirst({
      where: { id: chatId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!chat) throw new NotFoundError("Chat not found.");

    const messages = await prisma.message.findMany({
      where: { chatId },
      orderBy: { ordering: "asc" },
      include: {
        generatedImages: {
          where: { status: "completed" },
          select: { url: true },
          take: 1,
        },
      },
    });

    return jsonOk({
      messages: messages.map((m) => ({
        id: m.id,
        chatId: m.chatId,
        role: m.role,
        text: m.text,
        ordering: m.ordering,
        error: m.error,
        imageUrl: m.generatedImages[0]?.url,
        createdAt: m.createdAt.getTime(),
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

// POST /api/chats/[id]/messages
//
// Append the user's message AND trigger generation in one round-trip:
//   1. Validate + auth + ownership.
//   2. Rate-limit by userId (fal.ai generations are expensive).
//   3. In a transaction: insert the user message, then a placeholder
//      assistant message, then bump chat.updatedAt (and title if first msg).
//   4. Call generateImage() — it persists Prompt + GeneratedImage and
//      returns the URL. We then patch the assistant message with the URL.
//      (We use messageId on the GeneratedImage so the chat GET can join.)
//   5. Return both messages so the client can render immediately.
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { userId, dbUser } = await requireAuth();
    const chatId = idSchema.parse(params.id);
    // Bound the body to ~16 KiB — prompt cap is 2000 chars; this leaves
    // plenty of headroom while preventing a giant-JSON DoS.
    const body = postMessageSchema.parse(await readJson(req, 16 * 1024));

    // Per-user rate limit. Token bucket lives in lib/rateLimit.ts.
    // NOTE (pre-prod): in-memory bucket — see lib/rateLimit.ts. Move to
    // Redis/Upstash before scaling beyond a single serverless instance,
    // and add per-user concurrency limits (e.g. semaphore) so a user can't
    // fan out N parallel fal.ai calls before the bucket catches up.
    const rl = take(`user:${userId}`);
    if (!rl.ok) throw new RateLimitError(rl.retryAfter);

    // TODO(pre-prod): enforce credit / quota before generation. The schema
    // has `creditsBalance` / `monthlyQuota` columns and a CreditTransaction
    // model — they are not yet checked, so a paying tier will charge $$$
    // for unlimited generations. Wrap a SELECT FOR UPDATE on the user row,
    // decrement creditsBalance, and insert a CreditTransaction(consume) —
    // refund on generation failure.

    // Verify chat ownership up front (and grab title for first-message logic).
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, userId, deletedAt: null },
      select: { id: true, title: true, _count: { select: { messages: true } } },
    });
    if (!chat) throw new NotFoundError("Chat not found.");

    const isFirstMessage = chat._count.messages === 0;
    const newTitle =
      isFirstMessage && chat.title === "New Fitting"
        ? deriveTitle(body.prompt)
        : chat.title;

    // Insert user + pending assistant message in a single transaction so the
    // ordering invariant (unique chatId+ordering) is never violated by a
    // racing request. Using sequential awaits inside $transaction guarantees
    // they run in one DB transaction.
    // TODO: `baseOrdering` is computed from a count read OUTSIDE this txn
    // (chat._count above). Two near-simultaneous POSTs against the same
    // chat could both pick the same ordering and the unique constraint
    // would surface as a 500. Low-risk because it's chat-scoped and the
    // client is single-threaded per chat in practice; if we ever surface a
    // multi-device chat, switch to `SELECT MAX(ordering) FOR UPDATE` inside
    // the txn or use a per-chat advisory lock.
    const { userMsg, assistantMsg } = await prisma.$transaction(async (tx) => {
      const baseOrdering = chat._count.messages;
      const u = await tx.message.create({
        data: {
          chatId,
          userId,
          role: "user",
          text: body.prompt,
          ordering: baseOrdering,
        },
      });
      const a = await tx.message.create({
        data: {
          chatId,
          userId,
          role: "assistant",
          // Placeholder — we'll update with a final reply after generation.
          text: "",
          ordering: baseOrdering + 1,
        },
      });
      if (newTitle !== chat.title || isFirstMessage) {
        await tx.chat.update({
          where: { id: chatId },
          data: { title: newTitle, updatedAt: new Date() },
        });
      } else {
        await tx.chat.update({
          where: { id: chatId },
          data: { updatedAt: new Date() },
        });
      }
      return { userMsg: u, assistantMsg: a };
    });

    // Build a small system prompt from the user's style preferences so the
    // model has context. This is intentionally lightweight; richer prompt
    // composition can grow into its own module later.
    const systemPrompt = buildSystemPrompt(dbUser);

    let assistantText = "Here's a look I generated for you.";
    let assistantImageUrl: string | undefined;
    let errorFlag = false;

    log.info("generation_dispatch", {
      userId,
      chatId,
      messageId: assistantMsg.id,
      promptLen: body.prompt.length,
    });

    try {
      const gen = await generateImage({
        userId,
        prompt: body.prompt,
        systemPrompt,
        messageId: assistantMsg.id,
      });
      assistantImageUrl = gen.imageUrl;
      log.info("generation_ok", {
        userId,
        chatId,
        messageId: assistantMsg.id,
        imageId: gen.image.id,
      });
    } catch (err) {
      errorFlag = true;
      if (err instanceof GenerationError) {
        log.warn("generation_error", {
          userId,
          chatId,
          status: err.status,
          expose: err.expose,
          message: err.message,
        });
        assistantText = err.expose;
      } else {
        log.error("generation_unhandled", { userId, chatId, err });
        assistantText = "Generation failed. Please try again.";
      }
    }

    const finalAssistant = await prisma.message.update({
      where: { id: assistantMsg.id },
      data: { text: assistantText, error: errorFlag },
    });

    return jsonOk({
      userMessage: {
        id: userMsg.id,
        chatId,
        role: userMsg.role,
        text: userMsg.text,
        ordering: userMsg.ordering,
        error: false,
        createdAt: userMsg.createdAt.getTime(),
      },
      assistantMessage: {
        id: finalAssistant.id,
        chatId,
        role: finalAssistant.role,
        text: finalAssistant.text,
        ordering: finalAssistant.ordering,
        error: finalAssistant.error,
        imageUrl: assistantImageUrl,
        createdAt: finalAssistant.createdAt.getTime(),
      },
      chat: { id: chatId, title: newTitle },
    });
  } catch (err) {
    return handleError(err);
  }
}

function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= 42) return t || "New Fitting";
  return t.slice(0, 42) + "…";
}

function buildSystemPrompt(u: {
  gender: string | null;
  bodyType: string | null;
  size: string | null;
  favoriteColors: string[];
  styleTags: string[];
}): string {
  const parts: string[] = [
    "You are a personal fashion stylist who generates outfit images.",
  ];
  if (u.gender) parts.push(`User gender: ${u.gender}.`);
  if (u.bodyType) parts.push(`Body type: ${u.bodyType}.`);
  if (u.size) parts.push(`Size: ${u.size}.`);
  if (u.favoriteColors.length)
    parts.push(`Favorite colors: ${u.favoriteColors.join(", ")}.`);
  if (u.styleTags.length)
    parts.push(`Style preferences: ${u.styleTags.join(", ")}.`);
  return parts.join(" ");
}
