import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handleError, jsonOk, readJson } from "@/lib/errors";
import { createChatSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/chats — list current user's non-deleted chats, newest first.
export async function GET() {
  try {
    const { userId } = await requireAuth();
    const chats = await prisma.chat.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return jsonOk({
      chats: chats.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt.getTime(),
        updatedAt: c.updatedAt.getTime(),
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

// POST /api/chats — create empty chat.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth();
    // Title is optional; default to "New Fitting". Cap the body small —
    // the only field is a 120-char title.
    let body: unknown = {};
    const lenHeader = req.headers.get("content-length");
    if (lenHeader && lenHeader !== "0") {
      try {
        body = await readJson(req, 4 * 1024);
      } catch {
        // Soft-fail malformed bodies — empty body is valid here.
        body = {};
      }
    }
    const parsed = createChatSchema.parse(body);
    const chat = await prisma.chat.create({
      data: {
        userId,
        title: parsed.title ?? "New Fitting",
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return jsonOk({
      chat: {
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt.getTime(),
        updatedAt: chat.updatedAt.getTime(),
        messages: [],
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
