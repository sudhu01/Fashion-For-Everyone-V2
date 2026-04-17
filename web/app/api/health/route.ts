import { prisma } from "@/lib/db";
import { jsonOk, jsonError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness probe. Cheap SELECT 1 against Postgres so the platform can tell
// whether the process is alive AND can talk to its database.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return jsonOk({ status: "ok", time: new Date().toISOString() });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[health] db check failed", err);
    return jsonError(503, "Service unavailable.");
  }
}
