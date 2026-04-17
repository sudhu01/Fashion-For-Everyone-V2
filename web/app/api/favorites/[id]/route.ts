import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handleError, jsonOk, NotFoundError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

interface Ctx {
  params: { id: string };
}

// DELETE /api/favorites/[id] — unsave a look. The id is the Favorite row id.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { userId } = await requireAuth();
    const id = idSchema.parse(params.id);

    const result = await prisma.favorite.deleteMany({
      where: { id, userId },
    });
    if (result.count === 0) throw new NotFoundError("Favorite not found.");

    return jsonOk({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
