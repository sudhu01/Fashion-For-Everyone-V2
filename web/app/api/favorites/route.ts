import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BadRequestError, handleError, jsonOk, readJson } from "@/lib/errors";
import { createFavoriteSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/favorites — saved looks for the current user.
export async function GET() {
  try {
    const { userId } = await requireAuth();

    const favs = await prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        generatedImage: { select: { url: true } },
      },
    });

    return jsonOk({
      favorites: favs.map((f) => ({
        id: f.id,
        generatedImageId: f.generatedImageId,
        imageUrl: f.generatedImage.url,
        label: f.label,
        createdAt: f.createdAt.getTime(),
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

// POST /api/favorites — save a generated image. Idempotent via the unique
// (userId, generatedImageId) constraint — re-favoriting just updates the label.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = createFavoriteSchema.parse(await readJson(req, 4 * 1024));

    // Confirm ownership of the image before letting the user favorite it.
    // (Prevents leaking other users' image ids by guess.)
    const owns = await prisma.generatedImage.findFirst({
      where: { id: body.generatedImageId, userId },
      select: { id: true },
    });
    if (!owns) throw new BadRequestError("Unknown generatedImageId.");

    const fav = await prisma.favorite.upsert({
      where: {
        userId_generatedImageId: {
          userId,
          generatedImageId: body.generatedImageId,
        },
      },
      create: {
        userId,
        generatedImageId: body.generatedImageId,
        label: body.label,
      },
      update: { label: body.label },
      include: { generatedImage: { select: { url: true } } },
    });

    return jsonOk({
      favorite: {
        id: fav.id,
        generatedImageId: fav.generatedImageId,
        imageUrl: fav.generatedImage.url,
        label: fav.label,
        createdAt: fav.createdAt.getTime(),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
