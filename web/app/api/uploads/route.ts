import type { NextRequest } from "next/server";

import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handleError, jsonOk, BadRequestError, readJson } from "@/lib/errors";
import { createUploadSchema, MAX_UPLOAD_BYTES } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/uploads
//
// v1 design choice: accept a base64 data URI directly in JSON, persist the
// data URI as the Asset.url, and return the Asset row. We picked this over
// presigned S3/R2 URLs because:
//   * No third-party storage account / signing infra needed for the MVP.
//   * Keeps the front-end client-side simple (one POST, no multi-step flow).
//   * Vercel routes accept up to 4.5MB request bodies on the Hobby plan;
//     we cap at 5MB pre-decode and rely on the size guard below.
//
// When we add Cloudinary / S3 / R2 (likely v1.1 once images get larger or
// numerous), swap this handler to mint a presigned URL, change the schema
// to accept the resulting CDN URL, and keep the Asset row shape identical.
//
// MIME / format restricted to PNG / JPEG / WEBP via the regex in the
// validator. We do NOT decode/re-encode here — bytes are stored verbatim.

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth();

    // Stream the body with a hard byte budget so we never buffer beyond
    // ~2x the post-decode cap (base64 inflates ~33%, plus JSON envelope).
    // readJson() also respects content-length when present and aborts the
    // stream as soon as the cap is hit — so a lying client can't sneak in.
    const BODY_CAP = MAX_UPLOAD_BYTES * 2;
    const body = createUploadSchema.parse(await readJson(req, BODY_CAP));

    // Roughly estimate decoded size — base64 is ~4/3 bigger than raw.
    const base64Part = body.dataUri.split(",", 2)[1] ?? "";
    const approxBytes = Math.floor((base64Part.length * 3) / 4);
    if (approxBytes > MAX_UPLOAD_BYTES) {
      throw new BadRequestError("Upload exceeds 5MB.");
    }

    const mimeMatch = /^data:(image\/(?:png|jpeg|jpg|webp));base64,/.exec(
      body.dataUri
    );
    const mimeType = mimeMatch?.[1] ?? "image/png";

    // Defense in depth: sniff magic bytes so a renamed .html / .svg can't
    // sneak through by lying about its data URI prefix. Only the first few
    // bytes are needed for PNG / JPEG / WEBP detection, so we decode just
    // a small head-slice rather than the whole base64 blob.
    const headBytes = decodeBase64Head(base64Part, 16);
    if (!isAllowedImageMagic(headBytes, mimeType)) {
      throw new BadRequestError("Upload contents do not match a supported image type.");
    }

    const asset = await prisma.asset.create({
      data: {
        userId,
        kind: body.kind ?? "user_upload",
        url: body.dataUri,
        mimeType,
        sizeBytes: approxBytes,
        label: body.label,
      },
      select: {
        id: true,
        url: true,
        kind: true,
        mimeType: true,
        sizeBytes: true,
        label: true,
        createdAt: true,
      },
    });

    return jsonOk({
      asset: {
        id: asset.id,
        url: asset.url,
        kind: asset.kind,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        label: asset.label,
        createdAt: asset.createdAt.getTime(),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

// Decode just the first `n` bytes of a base64 string. We strip a leading
// chunk of base64 (each 4 chars → 3 bytes) and call Buffer.from on that —
// this avoids decoding the whole 5MB payload to peek at the first 12 bytes.
function decodeBase64Head(b64: string, n: number): Buffer {
  const cleaned = b64.replace(/\s+/g, "");
  const charsNeeded = Math.min(cleaned.length, Math.ceil(n / 3) * 4);
  return Buffer.from(cleaned.slice(0, charsNeeded), "base64").subarray(0, n);
}

function isAllowedImageMagic(buf: Buffer, claimedMime: string): boolean {
  if (buf.length < 4) return false;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47;
  // JPEG: FF D8 FF
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  // WEBP: "RIFF"...."WEBP"
  const isWebp =
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50;
  if (claimedMime === "image/png") return isPng;
  if (claimedMime === "image/jpeg" || claimedMime === "image/jpg") return isJpeg;
  if (claimedMime === "image/webp") return isWebp;
  return false;
}
