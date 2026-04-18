// Image-generation pipeline. Single place that talks to fal.ai so the rest of
// the app doesn't need to know about queue URLs, polling, or LoRA plumbing.
//
// Flow per call:
//   1. Sanitize + augment the raw user prompt (LoRA trigger phrase + training
//      distribution vocabulary — see lib/promptSanitizer).
//   2. Persist a pending Prompt + GeneratedImage row (paper trail even if the
//      upstream call hangs).
//   3. POST to fal's queue endpoint. If fal returns a final payload inline,
//      extract and finish.
//   4. Otherwise poll `status_url` until COMPLETED, then GET `response_url`
//      for the image(s).
//   5. Extract an image URL/data URI, validate host, persist, return.
//
// Auth-agnostic: callers must enforce auth and rate-limits before invoking.

import type { GeneratedImage, Prompt } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createLogger, describeShape } from "@/lib/logger";
import {
  type PromptFacets,
  sanitizeAndAugmentPrompt,
  SanitizationError,
} from "@/lib/promptSanitizer";

const log = createLogger("generation");

const FAL_KEY = process.env.FAL_KEY ?? process.env.FAL_API_KEY ?? "";
// fal model ids look like `fal-ai/<app>` or `fal-ai/<app>/<variant>`. FLUX.2
// Klein with a custom LoRA is served through fal's flux-lora variants; the
// exact slug depends on the deployment. Configurable so ops can swap without
// a code push.
const FAL_MODEL_ID = process.env.FAL_MODEL_ID ?? "fal-ai/flux-lora";
const LORA_URL = process.env.LORA_URL ?? "";
const LORA_STRENGTH = Number(process.env.LORA_STRENGTH ?? 0.85);
// Budget covers submit + polling + final response. Cold starts on large FLUX
// variants can push 2–3 min; default generously.
const UPSTREAM_TIMEOUT_MS = Number(process.env.FAL_TIMEOUT_MS ?? 300_000);
const POLL_INTERVAL_MS = Number(process.env.FAL_POLL_MS ?? 2_000);
// FLUX.2 Klein is a distilled variant (like Schnell): it accepts 1–8 steps
// and wants guidance_scale ≈ 1.0 (no classifier-free guidance). If you swap
// to a non-distilled FLUX checkpoint, bump these via env to 28 / 3.5.
const DEFAULT_STEPS = Number(process.env.FAL_STEPS ?? 4);
const DEFAULT_GUIDANCE = Number(process.env.FAL_GUIDANCE ?? 1.0);
const DEFAULT_IMAGE_SIZE = process.env.FAL_IMAGE_SIZE ?? "portrait_4_3";
// Image-to-image chaining within a chat. fal serves image-to-image through a
// DIFFERENT model slug than bare text-to-image (e.g.
// `fal-ai/flux-lora/image-to-image` vs `fal-ai/flux-lora`) — the t2i endpoint
// will 422 on `image_url`, so we dispatch to FAL_I2I_MODEL_ID when we have a
// reference image. Leave FAL_I2I_MODEL_ID unset to disable i2i entirely and
// fall back to plain text-to-image for every turn.
const FAL_I2I_MODEL_ID = process.env.FAL_I2I_MODEL_ID ?? "";
// fal's i2i endpoints come in two request shapes:
//   • "edit" style (FLUX.2 Klein edit, Kontext, etc.) → `image_urls: [url]`,
//     no `strength` (the model runs a full structured edit, not a noise-based
//     re-roll).
//   • "img2img" style (flux-lora/image-to-image, sdxl img2img, etc.) →
//     `image_url: url` + `strength`.
// Auto-detect from the slug so ops only have to set FAL_I2I_MODEL_ID. The
// override env var is there for the rare case where the slug is ambiguous.
const I2I_REQUEST_STYLE: "edit" | "img2img" =
  (process.env.FAL_I2I_STYLE as "edit" | "img2img" | undefined) ??
  (/\/edit(\/|$)|\bkontext\b/i.test(FAL_I2I_MODEL_ID) ? "edit" : "img2img");
// Noise strength for img2img (ignored in edit style). Lower = closer to
// reference, higher = more prompt freedom. 0.7 keeps the same garment
// recognizable while letting the prompt change sleeve length / color.
const IMG2IMG_STRENGTH = Number(process.env.FAL_IMG2IMG_STRENGTH ?? 0.7);

const MAX_URL_LEN = 4096;
const MAX_DATA_URI_LEN = 6 * 1024 * 1024;

// Optional allowlist for HTTPS image hosts the upstream model may legitimately
// return. fal serves assets from `fal.media` and `v3.fal.media`; setting this
// explicitly in prod means a compromised model can't point users at an
// attacker-controlled CDN. Leave unset for a permissive default.
const ALLOWED_IMAGE_HOSTS = (process.env.ALLOWED_IMAGE_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("[::1]")) return true;
  return false;
}

function isAllowedHttpsImageHost(host: string): boolean {
  if (!host) return false;
  if (isPrivateOrLoopbackHost(host)) return false;
  if (ALLOWED_IMAGE_HOSTS.length === 0) return true;
  return ALLOWED_IMAGE_HOSTS.includes(host.toLowerCase());
}

// Reference-image gate for img2img. Accepts either an https URL on the normal
// allowlist or a size-bounded image/* data URI (the same two shapes we persist
// from upstream). Defensive against passing e.g. a stale `blob:` URL or a
// data URI for an unrelated file type into the upstream request.
function isReferenceImageAcceptable(value: string): boolean {
  if (typeof value !== "string" || !value) return false;
  if (value.startsWith("data:")) {
    if (value.length > MAX_DATA_URI_LEN) return false;
    return /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
  }
  if (!/^https:\/\//i.test(value) || value.length > MAX_URL_LEN) return false;
  try {
    const u = new URL(value);
    if (u.username || u.password) return false;
    return isAllowedHttpsImageHost(u.hostname);
  } catch {
    return false;
  }
}

export class GenerationError extends Error {
  status: number;
  expose: string;
  constructor(status: number, expose: string, internal?: string) {
    super(internal ?? expose);
    this.status = status;
    this.expose = expose;
  }
}

// Cross-turn context the chat route supplies. `priorFacets` lets the sanitizer
// fill slots the current turn omitted ("in brown" → inherits garment/fit/fabric
// from the previous turn); `referenceImageUrl` is the prior turn's generated
// image, passed to fal as `image_url` when img2img is enabled.
export interface ChatContext {
  priorFacets?: PromptFacets | null;
  referenceImageUrl?: string | null;
}

export interface GenerateOptions {
  userId: string;
  prompt: string;             // raw user prompt — sanitized internally
  systemPrompt?: string;      // stored for audit; not passed to the model
  messageId?: string;
  extraParams?: Record<string, unknown>;
  chatContext?: ChatContext;
}

export interface GenerateResult {
  prompt: Prompt;
  // Front is the "primary" image — kept as `image` / `imageUrl` for back-compat
  // with older callers (e.g. /api/generate). Both views are always produced
  // in a single call with a shared seed for visual consistency.
  image: GeneratedImage;
  imageUrl: string;
  frontImage: GeneratedImage;
  backImage: GeneratedImage;
  frontUrl: string;
  backUrl: string;
  seed: number;
}

export function isConfigured(): boolean {
  return Boolean(FAL_KEY && FAL_MODEL_ID);
}

// fal model ids contain `/` — encode each path segment individually so the
// slashes survive.
function encodeFalModelPath(modelId: string): string {
  return modelId.split("/").map(encodeURIComponent).join("/");
}

export async function generateImage(
  opts: GenerateOptions,
): Promise<GenerateResult> {
  if (!isConfigured()) {
    log.error("not_configured", {
      hasKey: Boolean(FAL_KEY),
      hasModel: Boolean(FAL_MODEL_ID),
    });
    throw new GenerationError(503, "Image generation is not configured.");
  }

  // Sanitize + augment. Surfaces user-facing 400s for injection, NSFW,
  // non-fashion, or missing-garment input. priorFacets (if any) let the
  // sanitizer accept terse follow-ups like "in brown" by inheriting the
  // previous turn's garment/fit/fabric.
  const priorFacets = opts.chatContext?.priorFacets ?? null;
  let sanitized;
  try {
    sanitized = sanitizeAndAugmentPrompt(opts.prompt, priorFacets);
  } catch (err) {
    if (err instanceof SanitizationError) {
      log.warn("sanitizer_rejected", {
        userId: opts.userId,
        messageId: opts.messageId,
        reason: err.message,
        rawLen: opts.prompt.length,
        hasPriorFacets: Boolean(priorFacets),
      });
      throw new GenerationError(err.status, err.expose, err.message);
    }
    throw err;
  }

  // Two independent i2i decisions:
  //   - front view: i2i from a PRIOR-TURN image when the chat route supplied
  //     one (so "in brown" re-rolls the previous fitting).
  //   - back view: i2i from THIS turn's front render, regardless of chat
  //     context. The LoRA's back-view signal is weaker than its front-view
  //     signal (base FLUX has a strong "back view of <person>" prior that
  //     outvotes the LoRA once any OOD design text is present), so rendering
  //     back as an edit of the matched flat-lay front guarantees composition,
  //     color, and pattern match — and prevents human models / extra clothing
  //     from bleeding in.
  const priorReferenceImageUrl = opts.chatContext?.referenceImageUrl ?? null;
  const frontUsesI2I = Boolean(
    FAL_I2I_MODEL_ID &&
      priorReferenceImageUrl &&
      isReferenceImageAcceptable(priorReferenceImageUrl),
  );
  const backChainsFromFront = Boolean(FAL_I2I_MODEL_ID);
  const frontModelId = frontUsesI2I ? FAL_I2I_MODEL_ID : FAL_MODEL_ID;

  // One random seed shared across both views for the t2i fallback path.
  // When back chains as i2i from front the seed is less load-bearing (the
  // reference image dominates composition) but we still pass it for
  // reproducibility.
  const seed =
    typeof opts.extraParams?.seed === "number"
      ? (opts.extraParams.seed as number) >>> 0
      : Math.floor(Math.random() * 0xffffffff);

  const buildInputPayload = (
    promptText: string,
    mode: "t2i" | "i2i",
    referenceUrl: string | null,
  ): Record<string, unknown> => {
    const loras = LORA_URL ? [{ path: LORA_URL, scale: LORA_STRENGTH }] : [];
    return {
      prompt: promptText,
      image_size: DEFAULT_IMAGE_SIZE,
      num_inference_steps: DEFAULT_STEPS,
      guidance_scale: DEFAULT_GUIDANCE,
      num_images: 1,
      enable_safety_checker: true,
      seed,
      ...(loras.length ? { loras } : {}),
      ...(mode === "i2i" && referenceUrl
        ? I2I_REQUEST_STYLE === "edit"
          ? { image_urls: [referenceUrl] }
          : { image_url: referenceUrl, strength: IMG2IMG_STRENGTH }
        : {}),
      ...((opts.extraParams ?? {}) as Record<string, unknown>),
    };
  };

  const buildParamsJson = (
    view: "front" | "back",
    promptText: string,
    mode: "t2i" | "i2i",
    modelId: string,
    referenceUrl: string | null,
  ): Prisma.InputJsonValue => ({
    falModel: modelId,
    view,
    prompt: promptText,
    imageSize: DEFAULT_IMAGE_SIZE,
    steps: DEFAULT_STEPS,
    guidance: DEFAULT_GUIDANCE,
    seed,
    strippedTermCount: sanitized.stripped.length,
    facets: sanitized.facets as unknown as Prisma.InputJsonObject,
    filledFromContext: sanitized.filledFromContext,
    ...(LORA_URL
      ? { lora_url: LORA_URL, lora_strength: LORA_STRENGTH }
      : {}),
    ...(mode === "i2i"
      ? {
          img2img: true,
          i2iStyle: I2I_REQUEST_STYLE,
          i2iSource: view === "back" ? "front_of_same_turn" : "prior_turn",
          ...(I2I_REQUEST_STYLE === "img2img"
            ? { img2imgStrength: IMG2IMG_STRENGTH }
            : {}),
          ...(referenceUrl ? { referenceImageUrlPreview: referenceUrl.slice(0, 80) } : {}),
        }
      : {}),
    ...((opts.extraParams ?? {}) as Prisma.InputJsonObject),
  });

  log.info("call_start", {
    userId: opts.userId,
    messageId: opts.messageId,
    frontModel: frontModelId,
    frontMode: frontUsesI2I ? "i2i" : "t2i",
    backChainsFromFront,
    backModel: backChainsFromFront ? FAL_I2I_MODEL_ID : FAL_MODEL_ID,
    i2iStyle: backChainsFromFront || frontUsesI2I ? I2I_REQUEST_STYLE : undefined,
    frontPromptLen: sanitized.frontPrompt.length,
    backPromptLen: sanitized.backPrompt.length,
    rawPromptLen: opts.prompt.length,
    hasLora: Boolean(LORA_URL),
    requestedView: sanitized.view,
    seed,
    strippedCount: sanitized.stripped.length,
    hasSystemPrompt: Boolean(opts.systemPrompt),
    hasExtraParams: Boolean(opts.extraParams && Object.keys(opts.extraParams).length),
    hasPriorFacets: Boolean(priorFacets),
    filledFromContext: sanitized.filledFromContext,
    allowedHosts: ALLOWED_IMAGE_HOSTS.length,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });

  // One Prompt row per turn — its `text` stores the front-view string since
  // that's our primary render, but `params` carries both prompts so the full
  // call can be reproduced. Persist two pending GeneratedImage rows (one per
  // view) so failures leave a paper trail for each.
  const backModelId = backChainsFromFront ? FAL_I2I_MODEL_ID : FAL_MODEL_ID;
  const frontParams = buildParamsJson(
    "front",
    sanitized.frontPrompt,
    frontUsesI2I ? "i2i" : "t2i",
    frontModelId,
    frontUsesI2I ? priorReferenceImageUrl : null,
  );
  // The back reference URL is filled in after the front render completes;
  // persisted params just flag that back WILL chain from front so DB
  // readers can tell this apart from a plain-pair render.
  const backParams = buildParamsJson(
    "back",
    sanitized.backPrompt,
    backChainsFromFront ? "i2i" : "t2i",
    backModelId,
    null,
  );
  const promptRow = await prisma.prompt.create({
    data: {
      userId: opts.userId,
      messageId: opts.messageId,
      text: sanitized.frontPrompt,
      rawUserInput: opts.prompt,
      model: frontModelId,
      systemPrompt: opts.systemPrompt,
      params: {
        ...(frontParams as Prisma.InputJsonObject),
        backPrompt: sanitized.backPrompt,
        backModel: backModelId,
      },
    },
  });
  const pendingFront = await prisma.generatedImage.create({
    data: {
      userId: opts.userId,
      promptId: promptRow.id,
      messageId: opts.messageId,
      url: "",
      model: frontModelId,
      loraUrl: LORA_URL || null,
      params: frontParams,
      status: "pending",
    },
  });
  const pendingBack = await prisma.generatedImage.create({
    data: {
      userId: opts.userId,
      promptId: promptRow.id,
      messageId: opts.messageId,
      url: "",
      model: backModelId,
      loraUrl: LORA_URL || null,
      params: backParams,
      status: "pending",
    },
  });

  log.debug("rows_persisted", {
    promptId: promptRow.id,
    frontImageId: pendingFront.id,
    backImageId: pendingBack.id,
  });

  // A single AbortController drives the shared timeout covering both calls.
  // Front renders first so the back call can reference its URL.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const frontImage = await runOneUpstreamCall({
      view: "front",
      promptText: sanitized.frontPrompt,
      inputPayload: buildInputPayload(
        sanitized.frontPrompt,
        frontUsesI2I ? "i2i" : "t2i",
        frontUsesI2I ? priorReferenceImageUrl : null,
      ),
      pendingImageId: pendingFront.id,
      activeModelId: frontModelId,
      useImg2Img: frontUsesI2I,
      controller,
      startedAt,
    });

    // Back view: chain as i2i-edit from the front render when i2i is
    // configured. The front image anchors composition (flat-lay, no model)
    // and garment pattern/color, while the prompt rotates to the back view
    // caption. Fallback to t2i when FAL_I2I_MODEL_ID is unset.
    const backIsI2I = backChainsFromFront && isReferenceImageAcceptable(frontImage.url);
    if (backChainsFromFront && !backIsI2I) {
      log.warn("back_chain_skipped_bad_front_url", {
        frontUrlPreview: frontImage.url.slice(0, 80),
      });
    }
    const backImage = await runOneUpstreamCall({
      view: "back",
      promptText: sanitized.backPrompt,
      inputPayload: buildInputPayload(
        sanitized.backPrompt,
        backIsI2I ? "i2i" : "t2i",
        backIsI2I ? frontImage.url : null,
      ),
      pendingImageId: pendingBack.id,
      activeModelId: backIsI2I ? backModelId : FAL_MODEL_ID,
      useImg2Img: backIsI2I,
      controller,
      startedAt,
    });

    log.info("call_success", {
      promptId: promptRow.id,
      frontImageId: frontImage.id,
      backImageId: backImage.id,
      backMode: backIsI2I ? "i2i" : "t2i",
      seed,
      totalMs: Date.now() - startedAt,
    });

    return {
      prompt: promptRow,
      image: frontImage,
      imageUrl: frontImage.url,
      frontImage,
      backImage,
      frontUrl: frontImage.url,
      backUrl: backImage.url,
      seed,
    };
  } finally {
    clearTimeout(timeout);
  }
}

interface UpstreamCallArgs {
  view: "front" | "back";
  promptText: string;
  inputPayload: Record<string, unknown>;
  pendingImageId: string;
  activeModelId: string;
  useImg2Img: boolean;
  controller: AbortController;
  startedAt: number;
}

// One upstream request → one completed GeneratedImage row. The caller owns
// the abort controller and the pair of pending rows; this function just
// submits, polls, extracts, and finalizes the row. Kept in-module because
// it closes over logger / prisma / constants in a way that doesn't need to
// be exported.
async function runOneUpstreamCall(args: UpstreamCallArgs): Promise<GeneratedImage> {
  const { view, promptText, inputPayload, pendingImageId, activeModelId, useImg2Img, controller, startedAt } = args;
  const submitUrl = `https://queue.fal.run/${encodeFalModelPath(activeModelId)}`;

  try {
    log.info("upstream_request", {
      view,
      url: submitUrl,
      model: activeModelId,
      mode: useImg2Img ? "i2i" : "t2i",
      promptLen: promptText.length,
      paramKeys: Object.keys(inputPayload),
    });

    const submitRes = await fetch(submitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${FAL_KEY}`,
      },
      body: JSON.stringify(inputPayload),
      signal: controller.signal,
      cache: "no-store",
    });

    const submitDurationMs = Date.now() - startedAt;

    if (!submitRes.ok) {
      let bodyText = "";
      try { bodyText = await submitRes.text(); } catch { /* ignore */ }
      log.error("submit_non_ok", {
        view,
        status: submitRes.status,
        statusText: submitRes.statusText,
        durationMs: submitDurationMs,
        body: bodyText,
      });
      await markFailed(pendingImageId, `submit_${submitRes.status}`);
      throw new GenerationError(502, "Upstream generation failed.");
    }

    const submitJson = (await submitRes.json()) as unknown;
    log.info("submit_ok", {
      view,
      httpStatus: submitRes.status,
      durationMs: submitDurationMs,
      shape: describeShape(submitJson),
    });

    const inlineImage = extractImage(submitJson);
    const submitObj = (submitJson ?? {}) as {
      request_id?: unknown;
      status?: unknown;
      status_url?: unknown;
      response_url?: unknown;
    };
    const requestId =
      typeof submitObj.request_id === "string" ? submitObj.request_id : undefined;

    if (inlineImage) {
      return await finalize(view, pendingImageId, inlineImage, requestId, startedAt);
    }

    if (
      typeof submitObj.status_url !== "string" ||
      typeof submitObj.response_url !== "string" ||
      !requestId
    ) {
      log.error("submit_missing_fields", {
        view,
        shape: describeShape(submitJson),
        hasStatusUrl: typeof submitObj.status_url === "string",
        hasResponseUrl: typeof submitObj.response_url === "string",
        hasRequestId: Boolean(requestId),
      });
      await markFailed(pendingImageId, "submit_bad_response");
      throw new GenerationError(502, "Upstream returned malformed response.");
    }

    await waitUntilCompleted(
      submitObj.status_url,
      requestId,
      controller.signal,
      startedAt,
      pendingImageId,
    );

    const responseRes = await fetch(submitObj.response_url, {
      method: "GET",
      headers: { Authorization: `Key ${FAL_KEY}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!responseRes.ok) {
      let bodyText = "";
      try { bodyText = await responseRes.text(); } catch { /* ignore */ }
      log.error("response_non_ok", {
        view,
        requestId,
        status: responseRes.status,
        body: bodyText,
      });
      await markFailed(pendingImageId, `response_${responseRes.status}`);
      throw new GenerationError(502, "Upstream response fetch failed.");
    }

    const result = (await responseRes.json()) as unknown;
    log.info("response_ok", {
      view,
      requestId,
      shape: describeShape(result),
      elapsedMs: Date.now() - startedAt,
    });

    const imageUrl = extractImage(result);
    if (!imageUrl) {
      log.error("no_image_extracted", {
        view,
        requestId,
        shape: describeShape(result),
      });
      await markFailed(pendingImageId, "no_image_returned");
      throw new GenerationError(502, "Model returned no image.");
    }

    return await finalize(view, pendingImageId, imageUrl, requestId, startedAt);
  } catch (err) {
    if (err instanceof GenerationError) throw err;
    const aborted = err instanceof Error && err.name === "AbortError";
    log.error("upstream_threw", {
      view,
      aborted,
      durationMs: Date.now() - startedAt,
      err,
    });
    await markFailed(pendingImageId, aborted ? "timeout" : "upstream_error");
    throw new GenerationError(
      aborted ? 504 : 502,
      aborted ? "Generation timed out." : "Upstream error.",
    );
  }
}

async function finalize(
  view: "front" | "back",
  imageId: string,
  imageUrl: string,
  providerJobId: string | undefined,
  startedAt: number,
): Promise<GeneratedImage> {
  log.info("image_extracted", {
    view,
    kind: imageUrl.startsWith("data:") ? "data_uri" : "https_url",
    length: imageUrl.length,
    preview: imageUrl.startsWith("data:") ? imageUrl.slice(0, 40) : imageUrl,
  });

  const completed = await prisma.generatedImage.update({
    where: { id: imageId },
    data: {
      url: imageUrl,
      status: "completed",
      completedAt: new Date(),
      providerJobId,
    },
  });

  log.info("one_call_success", {
    view,
    imageId: completed.id,
    totalMs: Date.now() - startedAt,
  });

  return completed;
}

const PENDING_STATUSES = new Set(["IN_QUEUE", "IN_PROGRESS"]);
const TERMINAL_BAD_STATUSES = new Set([
  "FAILED", "CANCELLED", "TIMED_OUT", "ERROR",
]);

async function waitUntilCompleted(
  statusUrl: string,
  requestId: string,
  signal: AbortSignal,
  startedAt: number,
  imageId: string,
): Promise<void> {
  log.info("poll_start", {
    requestId,
    intervalMs: POLL_INTERVAL_MS,
    elapsedMs: Date.now() - startedAt,
  });
  let attempt = 0;
  while (true) {
    if (signal.aborted) {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }
    await sleep(POLL_INTERVAL_MS, signal);
    attempt += 1;
    const res = await fetch(statusUrl, {
      method: "GET",
      headers: { Authorization: `Key ${FAL_KEY}` },
      signal,
      cache: "no-store",
    });
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      log.error("poll_non_ok", {
        requestId,
        attempt,
        status: res.status,
        body,
      });
      throw new GenerationError(502, "Upstream status check failed.");
    }
    const payload = (await res.json()) as { status?: unknown };
    const s = typeof payload?.status === "string" ? payload.status : undefined;
    log.debug("poll_tick", {
      requestId,
      attempt,
      status: s ?? "(missing)",
      elapsedMs: Date.now() - startedAt,
    });
    if (s === "COMPLETED") {
      log.info("poll_done", {
        requestId,
        attempts: attempt,
        elapsedMs: Date.now() - startedAt,
      });
      return;
    }
    if (s && TERMINAL_BAD_STATUSES.has(s)) {
      log.error("poll_terminal_bad", { requestId, attempt, status: s });
      await markFailed(imageId, `job_${s.toLowerCase()}`);
      throw new GenerationError(502, "Generation job failed.");
    }
    if (s && !PENDING_STATUSES.has(s)) {
      log.warn("poll_status_unknown", { requestId, attempt, status: s });
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function markFailed(imageId: string, reason: string): Promise<void> {
  try {
    await prisma.generatedImage.update({
      where: { id: imageId },
      data: {
        status: "failed",
        failureReason: reason,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[generation] failed to mark image failed", err);
  }
}

function sniffImageMime(
  bytes: Uint8Array,
): "image/png" | "image/jpeg" | "image/webp" | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

// Extract a usable image URL / data URI from fal's response. fal canonically
// returns `{ images: [{ url: "..." }, ...] }`, but we also accept a handful
// of legacy shapes (bare string, `output.*`) as defense-in-depth against
// handler drift.
export function extractImage(data: unknown): string | null {
  log.debug("extract_start", {
    type: Array.isArray(data) ? "array" : typeof data,
    topKeys:
      data && typeof data === "object" && !Array.isArray(data)
        ? Object.keys(data as Record<string, unknown>).slice(0, 8)
        : null,
  });

  type Candidate = { source: string; value: unknown };
  const candidates: Candidate[] = [];

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;

    // fal canonical: images[].url
    if (Array.isArray(obj.images)) {
      obj.images.forEach((img, i) => {
        if (typeof img === "string") {
          candidates.push({ source: `images[${i}]`, value: img });
        } else if (img && typeof img === "object") {
          const url = (img as { url?: unknown }).url;
          if (url !== undefined) candidates.push({ source: `images[${i}].url`, value: url });
          const b64 = (img as { b64_json?: unknown }).b64_json;
          if (b64 !== undefined) candidates.push({ source: `images[${i}].b64_json`, value: b64 });
        }
      });
    }

    // Single-image shortcut some fal variants use.
    for (const k of ["image", "image_url", "imageUrl", "url"]) {
      if (k in obj) candidates.push({ source: k, value: obj[k] });
    }

    // Legacy/defensive: output.* (kept from the RunPod-era pipeline).
    const out = obj.output;
    if (typeof out === "string") candidates.push({ source: "output(string)", value: out });
    if (out && typeof out === "object" && !Array.isArray(out)) {
      const o = out as Record<string, unknown>;
      for (const k of ["image", "image_url", "imageUrl", "url", "b64", "image_base64", "base64"]) {
        if (k in o) candidates.push({ source: `output.${k}`, value: o[k] });
      }
      if (Array.isArray(o.images)) {
        o.images.forEach((v, i) => candidates.push({ source: `output.images[${i}]`, value: v }));
      }
    }
    if (Array.isArray(out)) {
      out.forEach((v, i) => candidates.push({ source: `output[${i}]`, value: v }));
    }
  }

  log.debug("extract_candidates", {
    count: candidates.length,
    sources: candidates.map((c) => c.source),
  });

  for (const { source, value } of candidates) {
    const result = validateImageString(source, value);
    if (result) return result;
  }

  log.warn("extract_no_match", { candidatesTried: candidates.length });
  return null;
}

function validateImageString(source: string, value: unknown): string | null {
  if (typeof value !== "string") {
    log.debug("extract_skip", { source, reason: "non-string", actualType: typeof value });
    return null;
  }
  const v = value.trim();
  if (!v) {
    log.debug("extract_skip", { source, reason: "empty" });
    return null;
  }

  if (v.startsWith("data:")) {
    if (v.length > MAX_DATA_URI_LEN) {
      log.warn("extract_skip", { source, reason: "data_uri_too_large", length: v.length });
      return null;
    }
    if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) {
      log.info("extract_match", { source, kind: "data_uri", length: v.length });
      return v;
    }
    log.warn("extract_skip", { source, reason: "data_uri_malformed", preview: v.slice(0, 60) });
    return null;
  }

  if (v.startsWith("http://") || v.startsWith("https://") || /^[a-z]+:\/\//i.test(v)) {
    if (v.length > MAX_URL_LEN) {
      log.warn("extract_skip", { source, reason: "url_too_long", length: v.length });
      return null;
    }
    try {
      const u = new URL(v);
      if (u.protocol !== "https:") {
        log.warn("extract_skip", { source, reason: "non_https", protocol: u.protocol });
        return null;
      }
      if (u.username || u.password) {
        log.warn("extract_skip", { source, reason: "url_has_credentials" });
        return null;
      }
      if (!isAllowedHttpsImageHost(u.hostname)) {
        log.warn("extract_skip", {
          source,
          reason: "host_not_allowed",
          host: u.hostname,
          allowedCount: ALLOWED_IMAGE_HOSTS.length,
        });
        return null;
      }
      log.info("extract_match", { source, kind: "https_url", host: u.hostname });
      return u.toString();
    } catch {
      log.warn("extract_skip", { source, reason: "url_parse_failed", preview: v.slice(0, 60) });
      return null;
    }
  }

  // Bare base64 — sniff magic bytes and wrap.
  const stripped = v.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(stripped)) {
    log.warn("extract_skip", { source, reason: "not_base64_or_url", preview: v.slice(0, 60) });
    return null;
  }
  if (stripped.length < 24) {
    log.debug("extract_skip", { source, reason: "base64_too_short", length: stripped.length });
    return null;
  }
  let head: Uint8Array;
  try {
    head = Uint8Array.from(Buffer.from(stripped.slice(0, 64), "base64"));
  } catch {
    log.warn("extract_skip", { source, reason: "base64_decode_failed" });
    return null;
  }
  const mime = sniffImageMime(head);
  if (!mime) {
    log.warn("extract_skip", {
      source,
      reason: "no_magic_byte_match",
      firstBytes: Array.from(head.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join(" "),
    });
    return null;
  }
  const dataUri = `data:${mime};base64,${stripped}`;
  if (dataUri.length > MAX_DATA_URI_LEN) {
    log.warn("extract_skip", { source, reason: "wrapped_data_uri_too_large", length: dataUri.length });
    return null;
  }
  log.info("extract_match", { source, kind: "bare_base64", mime, length: dataUri.length });
  return dataUri;
}
