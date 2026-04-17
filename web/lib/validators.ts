import { z } from "zod";

// Centralized zod schemas. Routes import from here so payload shapes stay
// in sync with the DB models and are documented in one place.

export const PROMPT_MIN = 2;
export const PROMPT_MAX = 2000;
export const TITLE_MAX = 120;

// --- Prompt / generation -----------------------------------------------

export const promptSchema = z
  .string()
  .transform((s) =>
    // Strip control chars except \n \r \t — same as the legacy /api/generate.
    s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim()
  )
  .pipe(z.string().min(PROMPT_MIN).max(PROMPT_MAX));

export const generateBodySchema = z.object({
  prompt: promptSchema,
});

// --- Chats -------------------------------------------------------------

export const createChatSchema = z
  .object({
    title: z.string().trim().min(1).max(TITLE_MAX).optional(),
  })
  .strict();

export const updateChatSchema = z
  .object({
    title: z.string().trim().min(1).max(TITLE_MAX),
  })
  .strict();

export const postMessageSchema = z
  .object({
    prompt: promptSchema,
  })
  .strict();

// --- User profile / preferences ---------------------------------------

export const genderSchema = z.enum([
  "female",
  "male",
  "non_binary",
  "prefer_not_to_say",
]);

export const updateMeSchema = z
  .object({
    firstName: z.string().trim().max(80).optional(),
    lastName: z.string().trim().max(80).optional(),
    gender: genderSchema.nullable().optional(),
    bodyType: z.string().trim().max(40).nullable().optional(),
    size: z.string().trim().max(20).nullable().optional(),
    heightCm: z.number().int().min(50).max(280).nullable().optional(),
    weightKg: z.number().int().min(20).max(500).nullable().optional(),
    favoriteColors: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    styleTags: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
    // `preferences` is intentionally free-form, but we bound it to keep an
    // attacker from stuffing megabytes of JSON into the column. Cap the
    // serialized size and the key count at conservative numbers; the route
    // also enforces a global body-size cap via readJson().
    preferences: z
      .record(z.string().max(64), z.unknown())
      .refine((v) => Object.keys(v).length <= 64, {
        message: "preferences may not have more than 64 keys",
      })
      .refine((v) => JSON.stringify(v).length <= 8 * 1024, {
        message: "preferences serialized JSON exceeds 8 KiB",
      })
      .optional(),
  })
  .strict();

// --- Wardrobe ----------------------------------------------------------

export const wardrobeCategorySchema = z.enum([
  "top",
  "bottom",
  "outerwear",
  "dress",
  "footwear",
  "accessory",
  "underwear",
  "swimwear",
  "activewear",
  "other",
]);

export const createWardrobeItemSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    category: wardrobeCategorySchema,
    color: z.string().trim().max(40).optional(),
    brand: z.string().trim().max(80).optional(),
    size: z.string().trim().max(20).optional(),
    season: z
      .enum(["spring", "summer", "fall", "winter", "all"])
      .optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    notes: z.string().trim().max(2000).optional(),
    assetId: z.string().uuid().optional(),
  })
  .strict();

// --- Uploads ----------------------------------------------------------
// v1: accept a base64 data URI in JSON. Capped at 5MB pre-decode (~3.75MB
// post-decode) to keep memory bounded and Vercel limits happy. See uploads
// route for the rationale and a note on swapping in S3 presigned URLs later.

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const createUploadSchema = z
  .object({
    // data:image/png;base64,...
    dataUri: z
      .string()
      .max(MAX_UPLOAD_BYTES * 2) // base64 inflates ~33%, give some slack.
      .regex(
        /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/,
        "dataUri must be a base64 png/jpeg/webp data URI"
      ),
    label: z.string().trim().max(120).optional(),
    kind: z.enum(["user_upload", "reference"]).optional(),
  })
  .strict();

// --- Favorites --------------------------------------------------------

export const createFavoriteSchema = z
  .object({
    generatedImageId: z.string().uuid(),
    label: z.string().trim().max(120).optional(),
  })
  .strict();
