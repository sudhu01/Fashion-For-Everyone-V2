import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BadRequestError, handleError, jsonOk, readJson } from "@/lib/errors";
import { createWardrobeItemSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toDTO(
  item: {
    id: string;
    name: string;
    category: string;
    color: string | null;
    brand: string | null;
    size: string | null;
    season: string | null;
    tags: string[];
    notes: string | null;
    assetId: string | null;
    createdAt: Date;
    updatedAt: Date;
  } & { asset?: { url: string } | null }
) {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    color: item.color,
    brand: item.brand,
    size: item.size,
    season: item.season,
    tags: item.tags,
    notes: item.notes,
    assetId: item.assetId,
    assetUrl: item.asset?.url ?? null,
    createdAt: item.createdAt.getTime(),
    updatedAt: item.updatedAt.getTime(),
  };
}

// GET /api/wardrobe — list current user's wardrobe items.
export async function GET() {
  try {
    const { userId } = await requireAuth();
    const items = await prisma.wardrobeItem.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { asset: { select: { url: true } } },
    });
    return jsonOk({ items: items.map(toDTO) });
  } catch (err) {
    return handleError(err);
  }
}

// POST /api/wardrobe — create a new wardrobe item.
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = createWardrobeItemSchema.parse(await readJson(req, 8 * 1024));

    // If they linked an asset, ensure it belongs to them.
    if (body.assetId) {
      const owns = await prisma.asset.findFirst({
        where: { id: body.assetId, userId },
        select: { id: true },
      });
      if (!owns) throw new BadRequestError("Unknown assetId.");
    }

    const item = await prisma.wardrobeItem.create({
      data: {
        userId,
        name: body.name,
        category: body.category,
        color: body.color,
        brand: body.brand,
        size: body.size,
        season: body.season,
        tags: body.tags ?? [],
        notes: body.notes,
        assetId: body.assetId,
      },
      include: { asset: { select: { url: true } } },
    });

    return jsonOk({ item: toDTO(item) });
  } catch (err) {
    return handleError(err);
  }
}
