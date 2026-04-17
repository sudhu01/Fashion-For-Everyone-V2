import { headers } from "next/headers";
import { Webhook } from "svix";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clerk webhook receiver. Verifies the Svix signature using
// CLERK_WEBHOOK_SECRET, then upserts/deletes the corresponding User row.
//
// IMPORTANT: this route MUST be excluded from Clerk middleware (it is
// public — the verification happens via signature, not session).

const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

interface ClerkEmailAddress {
  id: string;
  email_address: string;
}

interface ClerkUserData {
  id: string;
  email_addresses?: ClerkEmailAddress[];
  primary_email_address_id?: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
}

interface ClerkEvent {
  type: string;
  data: ClerkUserData;
}

function pickPrimaryEmail(data: ClerkUserData): string | null {
  const list = data.email_addresses ?? [];
  if (data.primary_email_address_id) {
    const hit = list.find((e) => e.id === data.primary_email_address_id);
    if (hit) return hit.email_address;
  }
  return list[0]?.email_address ?? null;
}

export async function POST(req: NextRequest) {
  if (!WEBHOOK_SECRET) {
    // eslint-disable-next-line no-console
    console.error("[webhooks/clerk] CLERK_WEBHOOK_SECRET not set");
    return jsonError(503, "Webhook not configured.");
  }

  const headerList = headers();
  const svixId = headerList.get("svix-id");
  const svixTimestamp = headerList.get("svix-timestamp");
  const svixSignature = headerList.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return jsonError(400, "Missing Svix headers.");
  }

  // Bound the webhook body. Clerk user payloads are well under 32 KiB; an
  // attacker who learns the URL but not the secret could otherwise stream
  // an unbounded body that we'd buffer before failing signature check.
  const MAX_WEBHOOK_BYTES = 64 * 1024;
  const lenHeader = req.headers.get("content-length");
  if (lenHeader && Number(lenHeader) > MAX_WEBHOOK_BYTES) {
    return jsonError(413, "Payload too large.");
  }
  let payload: string;
  try {
    const reader = req.body?.getReader();
    if (!reader) {
      return jsonError(400, "Empty body.");
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_WEBHOOK_BYTES) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          return jsonError(413, "Payload too large.");
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    payload = new TextDecoder("utf-8", { fatal: false }).decode(merged);
  } catch {
    return jsonError(400, "Failed to read body.");
  }
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: ClerkEvent;
  try {
    evt = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkEvent;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[webhooks/clerk] signature verification failed", err);
    return jsonError(400, "Invalid signature.");
  }

  try {
    switch (evt.type) {
      case "user.created":
      case "user.updated": {
        const d = evt.data;
        const email = pickPrimaryEmail(d);
        await prisma.user.upsert({
          where: { clerkId: d.id },
          create: {
            clerkId: d.id,
            email: email ?? undefined,
            username: d.username ?? undefined,
            firstName: d.first_name ?? undefined,
            lastName: d.last_name ?? undefined,
            imageUrl: d.image_url ?? undefined,
          },
          update: {
            email: email ?? undefined,
            username: d.username ?? undefined,
            firstName: d.first_name ?? undefined,
            lastName: d.last_name ?? undefined,
            imageUrl: d.image_url ?? undefined,
          },
        });
        break;
      }
      case "user.deleted": {
        // Cascade deletes will handle owned data.
        await prisma.user
          .delete({ where: { clerkId: evt.data.id } })
          .catch(() => {
            // Ignore "record not found" — webhook may double-fire.
          });
        break;
      }
      default:
        // Unknown event types are acknowledged so Clerk doesn't retry forever.
        break;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[webhooks/clerk] handler error", err);
    return jsonError(500, "Webhook handler failed.");
  }

  return jsonOk({ received: true });
}
