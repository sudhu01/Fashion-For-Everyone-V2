import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handleError, jsonOk, NotFoundError, readJson } from "@/lib/errors";
import { updateChatSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

interface Ctx {
  params: { id: string };
}

// GET /api/chats/[id] — chat + ordered messages. Verifies ownership.
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await requireAuth();
    const id = idSchema.parse(params.id);

    const chat = await prisma.chat.findFirst({
      where: { id, userId, deletedAt: null },
      include: {
        messages: {
          orderBy: { ordering: "asc" },
          include: {
            generatedImages: {
              where: { status: "completed" },
              select: { url: true, params: true, completedAt: true },
              orderBy: { completedAt: "asc" },
            },
          },
        },
      },
    });
    if (!chat) throw new NotFoundError("Chat not found.");

    return jsonOk({
      chat: {
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt.getTime(),
        updatedAt: chat.updatedAt.getTime(),
        messages: chat.messages.map((m) => {
          const { frontUrl, backUrl } = pickViewUrls(m.generatedImages);
          return {
            id: m.id,
            chatId: m.chatId,
            role: m.role,
            text: m.text,
            ordering: m.ordering,
            error: m.error,
            imageUrl: frontUrl ?? backUrl,
            frontImageUrl: frontUrl,
            backImageUrl: backUrl,
            createdAt: m.createdAt.getTime(),
          };
        }),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

// PATCH /api/chats/[id] — rename.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await requireAuth();
    const id = idSchema.parse(params.id);
    const body = updateChatSchema.parse(await readJson(req, 4 * 1024));

    // updateMany so we can both filter by userId AND atomically check it.
    const result = await prisma.chat.updateMany({
      where: { id, userId, deletedAt: null },
      data: { title: body.title },
    });
    if (result.count === 0) throw new NotFoundError("Chat not found.");

    return jsonOk({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

// Splits a message's completed GeneratedImage rows into front/back by reading
// `params.view`. Legacy single-view rows (no params) fall back to insertion
// order: first becomes front, second becomes back.
function pickViewUrls(
  images: { url: string; params: unknown }[],
): { frontUrl: string | undefined; backUrl: string | undefined } {
  let frontUrl: string | undefined;
  let backUrl: string | undefined;
  for (const img of images) {
    const v =
      img.params && typeof img.params === "object" && !Array.isArray(img.params)
        ? (img.params as Record<string, unknown>).view
        : undefined;
    if (v === "back" && !backUrl) backUrl = img.url;
    else if (!frontUrl) frontUrl = img.url;
    else if (!backUrl) backUrl = img.url;
  }
  return { frontUrl, backUrl };
}

// DELETE /api/chats/[id] — soft-delete.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await requireAuth();
    const id = idSchema.parse(params.id);

    const result = await prisma.chat.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundError("Chat not found.");

    return jsonOk({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
