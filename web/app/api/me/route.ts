import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handleError, jsonOk, readJson } from "@/lib/errors";
import { updateMeSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toDTO(u: Awaited<ReturnType<typeof prisma.user.findUnique>>) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    imageUrl: u.imageUrl,
    gender: u.gender,
    bodyType: u.bodyType,
    size: u.size,
    heightCm: u.heightCm,
    weightKg: u.weightKg,
    favoriteColors: u.favoriteColors,
    styleTags: u.styleTags,
    preferences: u.preferences as Record<string, unknown>,
    monthlyQuota: u.monthlyQuota,
    creditsBalance: u.creditsBalance,
    createdAt: u.createdAt.getTime(),
  };
}

// GET /api/me — current user's profile + style preferences.
export async function GET() {
  try {
    const { userId } = await requireAuth();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return jsonOk({ user: toDTO(user) });
  } catch (err) {
    return handleError(err);
  }
}

// PATCH /api/me — partial update of profile + preferences.
export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireAuth();
    // Cap profile payload at 32 KiB — the JSON `preferences` blob is the
    // only unbounded field and we don't want to land 50MB blobs in Postgres.
    const body = updateMeSchema.parse(await readJson(req, 32 * 1024));

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        gender: body.gender ?? undefined,
        bodyType: body.bodyType,
        size: body.size,
        heightCm: body.heightCm,
        weightKg: body.weightKg,
        favoriteColors: body.favoriteColors,
        styleTags: body.styleTags,
        preferences: body.preferences as never, // JSON column accepts any.
      },
    });

    return jsonOk({ user: toDTO(user) });
  } catch (err) {
    return handleError(err);
  }
}
