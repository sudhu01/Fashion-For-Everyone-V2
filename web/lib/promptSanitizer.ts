// Prompt sanitization + augmentation for the Fashion For Everyone LoRA that
// rides on top of FLUX.2 Klein. The rules here are derived from an audit of
// the ~348 training captions in /final_dataset, not invented. Two facts drive
// everything:
//
//   1. Every caption starts with "front view of" or "back view of" — that IS
//      the LoRA's activation phrase. Drop it and the LoRA effectively doesn't
//      fire.
//   2. Captions only use domain vocabulary: fit, garment, fabric, construction
//      details. No scenes, no lighting, no colors (color is learned from the
//      image pixels, not the text), no aesthetic adjectives. Extra user-supplied
//      noise (`at the beach`, `cinematic 8k`, `elegant`) pulls the model AWAY
//      from the trained distribution, so we aggressively strip it.
//
// The training set is also men's-only — so this rejects `dress`, `skirt`, etc.
// up front rather than hand the model a prompt it can't honor.

import { createLogger } from "@/lib/logger";

const log = createLogger("sanitizer");

export const PROMPT_OUTPUT_MAX = 400;

export class SanitizationError extends Error {
  status = 400;
  expose: string;
  constructor(expose: string, internal?: string) {
    super(internal ?? expose);
    this.expose = expose;
  }
}

// Structured facets extracted from the user's prompt. Persisted on the
// Prompt row so subsequent turns in the same chat can merge them in — e.g.
// turn 2 says "in brown" and we fill `garment` / `fit` / `fabric` from the
// previous turn's facets instead of rejecting the message.
export interface PromptFacets {
  view: "front" | "back";
  fit: string | null;
  color: string | null;
  garment: string | null;
  fabric: string | null;
  details: string[];
  // Out-of-distribution design phrases the user supplied that aren't in the
  // training vocabulary (e.g. "floral design pattern", "paisley print"). We
  // preserve them verbatim so FLUX's base model can honor them — the LoRA
  // won't, but base FLUX will, and the structural trigger remains intact.
  freeform: string[];
}

export interface SanitizedPrompt {
  // Primary prompt — matches the user's requested view (defaults to front
  // when unspecified). Kept as `prompt` for back-compat with callers that
  // only render one image per turn.
  prompt: string;
  // Both view variants always populated. Generation renders both in parallel
  // with a shared seed so a single chat turn returns matching front + back.
  frontPrompt: string;
  backPrompt: string;
  view: "front" | "back";
  facets: PromptFacets;
  stripped: string[];
  rawNormalized: string;
  // True if any slot (garment/fit/fabric/color) was supplied by prior-turn
  // context rather than the current raw prompt. Useful for telemetry and
  // for deciding whether to pass a reference image to img2img.
  filledFromContext: boolean;
}

// Extract facets from a persisted Prompt.params JSON blob. Defensive —
// returns null if the blob doesn't have a usable facets sub-object (legacy
// rows, migrations, hand-edited data).
export function extractFacetsFromParams(params: unknown): PromptFacets | null {
  if (!params || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  const f = p.facets;
  if (!f || typeof f !== "object") return null;
  const facets = f as Record<string, unknown>;
  const toStr = (x: unknown): string | null =>
    typeof x === "string" && x.trim().length > 0 ? x : null;
  const view = facets.view === "back" ? "back" : "front";
  const details = Array.isArray(facets.details)
    ? facets.details.filter((d): d is string => typeof d === "string")
    : [];
  const freeform = Array.isArray(facets.freeform)
    ? facets.freeform.filter((d): d is string => typeof d === "string")
    : [];
  return {
    view,
    fit: toStr(facets.fit),
    color: toStr(facets.color),
    garment: toStr(facets.garment),
    fabric: toStr(facets.fabric),
    details,
    freeform,
  };
}

const TRIGGER_FRONT = "front view of";
const TRIGGER_BACK = "back view of";

// Ordered longest-first so compound phrases (`polo shirt`, `bermuda shorts`,
// `bomber jacket`) beat their single-word prefixes.
const GARMENT_MAP: Record<string, string> = {
  "polo shirt": "polo shirt",
  "puffer jacket": "puffer jacket",
  "bomber jacket": "bomber jacket",
  "denim jacket": "denim jacket",
  "bermuda shorts": "bermuda shorts",
  "varsity jacket": "varsity jacket",
  "t-shirt": "t-shirt",
  overshirt: "overshirt",
  sweatshirt: "sweatshirt",
  turtleneck: "sweatshirt",
  pullover: "sweatshirt",
  cardigan: "cardigan",
  overcoat: "coat",
  trousers: "trousers",
  chinos: "trousers",
  bermuda: "bermuda shorts",
  varsity: "varsity jacket",
  hoodie: "hoodie",
  sweater: "sweatshirt",
  blazer: "blazer",
  jacket: "jacket",
  henley: "t-shirt",
  tshirt: "t-shirt",
  bomber: "bomber jacket",
  puffer: "puffer jacket",
  parka: "parka",
  jeans: "jeans",
  pants: "trousers",
  polo: "polo shirt",
  shirt: "shirt",
  shorts: "shorts",
  coat: "coat",
  vest: "vest",
  tee: "t-shirt",
};

// Women's-only terms → hard reject. The LoRA was trained on men's garments;
// asking for a dress will either fail the LoRA or produce a uncanny result.
const BANNED_GARMENTS = new Set([
  "dress", "gown", "skirt", "bodysuit", "lingerie", "bra", "panties",
  "leggings", "tights", "corset", "blouse",
]);

const FIT_MAP: Record<string, string> = {
  "wide-leg": "wide-leg",
  "wide leg": "wide-leg",
  "straight-leg": "straight-leg",
  "straight leg": "straight-leg",
  oversized: "relaxed fit",
  relaxed: "relaxed fit",
  classic: "regular fit",
  regular: "regular fit",
  cropped: "cropped fit",
  skinny: "slim fit",
  fitted: "slim fit",
  baggy: "relaxed fit",
  normal: "regular fit",
  flared: "flare fit",
  loose: "relaxed fit",
  tight: "slim fit",
  slim: "slim fit",
  wide: "wide-leg",
  flare: "flare fit",
  boxy: "boxy fit",
};

const COLORS = new Set([
  "red","orange","yellow","green","blue","purple","pink","black","white",
  "grey","gray","brown","beige","tan","cream","navy","olive","teal",
  "maroon","burgundy","charcoal","khaki","ivory","mustard","sage","mint",
  "rust","coral","lavender","turquoise",
]);

const FABRICS = new Set([
  "cotton","denim","wool","linen","silk","polyester","nylon","cashmere",
  "viscose","leather","suede","tweed","corduroy","fleece","jersey","knit",
  "canvas","chambray","flannel","pique","terrycloth","modal",
]);

// Construction vocabulary actually used in training captions. If a word is
// here it's kept as a detail clause; otherwise it's dropped.
const DETAIL_WHITELIST = new Set([
  "notched","lapel","spread","button-down","buttoned","collar","collared",
  "v-neck","crew-neck","round-neck","hooded","high-neck","neck","neckline",
  "long-sleeve","short-sleeve","sleeveless","sleeve","sleeves",
  "short","long","cuff","cuffs",
  "welt","patch","flap","jetted","kangaroo","chest","hip","inside","rear",
  "pocket","pockets","five-pocket",
  "ribbed","trim","trims","hem","vent","vents","back-vent",
  "zip","zipped","zipper","button","buttons","snap","snap-button",
  "drawstring","waistband","drawcord","elastic","belt",
  "faded","washed","ripped","distressed","contrast","stitched",
  "printed","plain","solid","striped","checked","embroidered",
  "logo","graphic",
]);

// Signals every training caption attaches to a given garment. We append any
// that the user didn't already express — otherwise FLUX's base-model
// semantics take over and produce e.g. a t-shirt when the user asked for
// "shirt with short sleeves" (LoRA knows "shirt" is button-up, base FLUX
// doesn't). Each entry is `[clause, probes]` where `probes` is the set of
// tokens whose presence in user details means the clause is redundant.
const GARMENT_SIGNALS: Record<
  string,
  { clause: string; probes: string[] }
> = {
  shirt: {
    clause: "with a lapel collar and a button-up front",
    probes: ["collar", "collared", "button-up", "buttoned", "lapel", "notched", "spread"],
  },
  "polo shirt": {
    clause: "with a lapel collar and ribbed trims",
    probes: ["collar", "collared", "lapel", "ribbed"],
  },
  "t-shirt": {
    clause: "with a round neck",
    probes: ["neck", "neckline", "round-neck", "v-neck", "crew-neck", "high-neck", "collar"],
  },
  overshirt: {
    clause: "with a collar and front button fastening",
    probes: ["collar", "collared", "button-up", "buttoned", "zip"],
  },
  "bomber jacket": {
    clause: "with ribbed trims and a front zip fastening",
    probes: ["ribbed", "zip", "zipped", "trims"],
  },
  hoodie: {
    clause: "with a hooded neckline and a kangaroo pocket",
    probes: ["hooded", "hood", "kangaroo", "neck"],
  },
};

// Normalize common user phrasings into the exact form the training captions
// use. Everything here is applied to the normalized prompt BEFORE fit /
// garment / token extraction — so "short-sleeved" and "short sleeves" both
// end up as the caption-native "short sleeves" (space, plural) which survives
// the whitelist as two tokens.
// Details that are mutually exclusive. When the current turn supplies any
// member of a family, prior-turn members in the same family are DROPPED
// during merge — otherwise "short sleeves" from turn 1 + "long sleeves"
// from turn 2 would both survive union-merge and confuse the model. Most
// entries correspond to obvious visual toggles (sleeve length, neckline,
// surface pattern); keep them conservative.
const EXCLUSIVE_DETAIL_FAMILIES: string[][] = [
  ["short", "long", "sleeveless"],
  ["v-neck", "round-neck", "crew-neck", "high-neck", "hooded"],
  ["plain", "solid", "striped", "checked", "printed", "embroidered"],
  ["faded", "washed", "distressed", "ripped"],
];

const COMPOUND_REWRITES: Array<[RegExp, string]> = [
  [/\bshort[-\s]sleeve(?:d|s)?\b/g, "short sleeves"],
  [/\blong[-\s]sleeve(?:d|s)?\b/g, "long sleeves"],
  [/\bhalf[-\s]sleeve(?:d|s)?\b/g, "short sleeves"],
  [/\bfull[-\s]sleeve(?:d|s)?\b/g, "long sleeves"],
  [/\b(?:no|without)\s+sleeve(?:s)?\b/g, "sleeveless"],
  [/\bv[-\s]neck(?:ed)?\b/g, "v-neck"],
  [/\bcrew[-\s]neck(?:ed)?\b/g, "crew-neck"],
  [/\bround[-\s]neck(?:ed)?\b/g, "round-neck"],
  [/\bhigh[-\s]neck(?:ed)?\b/g, "high-neck"],
  [/\bbutton[-\s]down\b/g, "button-down"],
  [/\bfive[-\s]pocket\b/g, "five-pocket"],
  [/\bback[-\s]vent\b/g, "back-vent"],
  [/\bsnap[-\s]button\b/g, "snap-button"],
];

// Words we know belong to the "noise" category — photography jargon, scene
// descriptions, aesthetic fluff. Explicitly listed so we can log what we
// dropped rather than silently nuking unknown tokens.
const STRIP_WORDS = new Set([
  "beach","park","studio","outdoors","indoors","city","street","forest","mountain",
  "sunset","sunrise","backdrop","background","location","scene","landscape",
  "restaurant","cafe","office","bedroom","gym","pool","desert","snow",
  "cinematic","bokeh","4k","8k","hdr","photorealistic","photoreal","realistic",
  "masterpiece","resolution","quality","professional","photograph","photography",
  "photo","lighting","softbox","studio-lighting","camera","lens","dslr","aperture",
  "beautiful","pretty","gorgeous","elegant","stylish","chic","sexy","cute",
  "handsome","cool","attractive","amazing","stunning","perfect","fantastic",
  "model","person","man","woman","guy","girl","male","female",
]);

// Attempts to trick downstream LLMs / prompt systems. The image model itself
// doesn't care, but we never want these reaching the audit log or a future
// LLM-in-the-loop path.
const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\s+(all|any|the)?\s*(previous|prior|above|earlier|preceding)\b/i,
  /\b(system|assistant|developer)\s+prompt\b/i,
  /\byou\s+are\s+(now|actually)\b/i,
  /\bact\s+as\s+(a|an)\b/i,
  /<\/?(system|assistant|user|instruction|tool)\b/i,
  /\[\s*\/?\s*(inst|system|assistant)\s*\]/i,
  /^#{3,}\s/m,
  /```/,
];

const NSFW_PATTERNS: RegExp[] = [
  /\b(nude|naked|nsfw|porn|pornographic|explicit|erotic|topless|bottomless)\b/i,
  /\b(sexual|sexualized|seductive|provocative)\b/i,
  /\b(loli|shota)\b/i,
  /\b(minor|child|kid|underage|teen|teenage|toddler|baby)\b/i,
];

const NON_FASHION_PATTERNS: RegExp[] = [
  /\b(sql|python|javascript|typescript|bash|shell|powershell|hack)\b/i,
  /\b(weapon|firearm|gun|rifle|knife|bomb|drug|cocaine|heroin|meth)\b/i,
  /\b(gore|violence|blood|wound|corpse)\b/i,
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase()
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/[^a-z0-9\s.,\-'"/%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeAndAugmentPrompt(
  raw: string,
  priorFacets?: PromptFacets | null,
): SanitizedPrompt {
  if (typeof raw !== "string") {
    throw new SanitizationError("Prompt must be a string.");
  }
  let normalized = normalize(raw);
  if (normalized.length < 2) {
    throw new SanitizationError("Please describe what you'd like to see.");
  }

  // Canonicalize common phrasings so the token-level whitelist doesn't miss
  // things users write in plain English (`short-sleeved`, `v neck`, etc.).
  for (const [re, replacement] of COMPOUND_REWRITES) {
    normalized = normalized.replace(re, replacement);
  }

  for (const p of INJECTION_PATTERNS) {
    if (p.test(normalized)) {
      throw new SanitizationError(
        "Prompt contains disallowed instructions. Please describe a fashion look.",
        `injection_match:${p.source}`,
      );
    }
  }
  for (const p of NSFW_PATTERNS) {
    if (p.test(normalized)) {
      throw new SanitizationError(
        "NSFW or unsafe content is not allowed.",
        `nsfw_match:${p.source}`,
      );
    }
  }
  for (const p of NON_FASHION_PATTERNS) {
    if (p.test(normalized)) {
      throw new SanitizationError(
        "This model only generates fashion imagery. Please describe a garment.",
        `non_fashion_match:${p.source}`,
      );
    }
  }

  // Pre-tokenize just to check the banned garment list — the main extraction
  // pass below works on the original normalized string so compound phrases
  // survive.
  const preTokens = normalized.split(/[\s,./]+/).filter(Boolean);
  for (const t of preTokens) {
    if (BANNED_GARMENTS.has(t)) {
      throw new SanitizationError(
        "This model is trained on menswear only. Please request a blazer, jacket, hoodie, shirt, polo, t-shirt, jeans, trousers, shorts, coat, or overshirt.",
        `banned_garment:${t}`,
      );
    }
  }

  const view: "front" | "back" =
    /\bback\s*(view|side)\b/.test(normalized) || /\bfrom\s+behind\b/.test(normalized)
      ? "back"
      : "front";

  let fit: string | null = null;
  let color: string | null = null;
  let garment: string | null = null;
  let fabric: string | null = null;
  const details: string[] = [];
  const stripped: string[] = [];
  const freeform: string[] = [];

  // Greedy longest-first extraction for fit / garment. The `g` flag lets us
  // drop every occurrence from `rest` so it doesn't get re-counted as noise.
  let rest = normalized;
  for (const key of Object.keys(FIT_MAP).sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${escapeRegex(key)}\\b`, "g");
    if (re.test(rest)) {
      if (!fit) fit = FIT_MAP[key];
      rest = rest.replace(new RegExp(`\\b${escapeRegex(key)}\\b`, "g"), " ");
    }
  }
  for (const key of Object.keys(GARMENT_MAP).sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${escapeRegex(key)}\\b`, "g");
    if (re.test(rest)) {
      if (!garment) garment = GARMENT_MAP[key];
      rest = rest.replace(new RegExp(`\\b${escapeRegex(key)}\\b`, "g"), " ");
    }
  }

  // Walk tokens once, but keep a rolling "freeform run" — a contiguous stretch
  // of tokens that are neither structural (color/fabric/whitelisted detail)
  // nor noise (stopwords / strip list). Runs flush on any structural or noise
  // hit so they preserve adjacency, e.g. "floral design pattern" stays as a
  // phrase instead of disintegrating into unordered tokens.
  const STOPWORDS = new Set([
    "front", "back", "view", "side",
    "made", "from", "with", "a", "an", "the", "of", "and", "in", "to",
    "on", "for", "that", "this", "is", "it", "featuring", "has", "have",
  ]);
  let currentRun: string[] = [];
  const flushRun = () => {
    if (currentRun.length > 0) {
      // Cap each run to avoid injection-by-long-phrase. Anything that passed
      // the injection / NSFW / non-fashion checks at the top of the function
      // is already safe; this just bounds prompt length.
      freeform.push(currentRun.slice(0, 6).join(" "));
      currentRun = [];
    }
  };
  for (const tok of rest.split(/[\s,./]+/).filter(Boolean)) {
    if (STOPWORDS.has(tok)) { flushRun(); continue; }
    if (COLORS.has(tok)) { if (!color) color = tok; flushRun(); continue; }
    if (FABRICS.has(tok)) { if (!fabric) fabric = tok; flushRun(); continue; }
    if (DETAIL_WHITELIST.has(tok)) { details.push(tok); flushRun(); continue; }
    if (STRIP_WORDS.has(tok)) { stripped.push(tok); flushRun(); continue; }
    // Unknown, non-noise — keep as potential design / pattern / decoration
    // intent (e.g. "floral", "pinstripe", "paisley", "camo"). The LoRA won't
    // recognize these, but base FLUX will.
    currentRun.push(tok);
  }
  flushRun();

  // Merge prior-turn facets to fill slots the current turn didn't mention.
  // e.g. turn 1 = "beige linen shirt", turn 2 = "in brown" — the second turn
  // has no garment, fit, or fabric on its own, but the user expects the same
  // shirt with a color swap. We only fall back to prior values for slots
  // the current turn omitted; current-turn values always win.
  let filledFromContext = false;
  if (priorFacets) {
    if (!garment && priorFacets.garment) {
      garment = priorFacets.garment;
      filledFromContext = true;
    }
    if (!fit && priorFacets.fit) {
      fit = priorFacets.fit;
      filledFromContext = true;
    }
    if (!color && priorFacets.color) {
      color = priorFacets.color;
      filledFromContext = true;
    }
    if (!fabric && priorFacets.fabric) {
      fabric = priorFacets.fabric;
      filledFromContext = true;
    }
    // Union-merge details, but drop any prior-turn detail that conflicts
    // with a current-turn detail via EXCLUSIVE_DETAIL_FAMILIES. This is what
    // makes "generate the same shirt with long sleeves" actually produce
    // long sleeves instead of blending both lengths.
    const currentDetailSet = new Set(details);
    const evictedByFamily = new Set<string>();
    for (const family of EXCLUSIVE_DETAIL_FAMILIES) {
      if (family.some((m) => currentDetailSet.has(m))) {
        for (const m of family) {
          if (!currentDetailSet.has(m)) evictedByFamily.add(m);
        }
      }
    }
    for (const d of priorFacets.details) {
      if (evictedByFamily.has(d)) continue;
      if (!details.includes(d)) {
        details.push(d);
        filledFromContext = true;
      }
    }
    // Freeform runs carry over too — e.g. turn 1 asks for "floral design
    // pattern", turn 2 says "in red" → the floral pattern should persist.
    for (const f of priorFacets.freeform ?? []) {
      if (!freeform.includes(f)) {
        freeform.push(f);
        filledFromContext = true;
      }
    }
  }

  if (!garment) {
    throw new SanitizationError(
      "Please mention a garment (blazer, jacket, hoodie, shirt, polo, t-shirt, jeans, trousers, shorts, coat, or overshirt).",
    );
  }

  const fitPhrase = fit ?? "regular fit";
  const fabricPhrase = fabric ? `${fabric} fabric` : "cotton fabric";
  const colorWord = color ? `${color} ` : "";

  // Build the view-agnostic body once, then stitch both trigger phrases in
  // front of it. The LoRA was trained on both "front view of" and "back view
  // of" captions with otherwise-identical garment descriptions, so emitting
  // both variants and rendering them with a shared seed yields consistent
  // front/back pairs of the same garment.
  let body = `${fitPhrase} ${colorWord}${garment} made from ${fabricPhrase}.`;
  const uniqDetails = Array.from(new Set(details)).slice(0, 8);
  if (uniqDetails.length) {
    body += ` featuring ${uniqDetails.join(" ")}.`;
  }

  // Inject training-distribution signals for this garment unless the user
  // already expressed them — closes the gap where "shirt with short sleeves"
  // was rendering as a t-shirt because base-FLUX semantics dominate without
  // an explicit button-up cue.
  const signal = GARMENT_SIGNALS[garment];
  if (signal) {
    const userCoversSignal = signal.probes.some((p) => uniqDetails.includes(p));
    if (!userCoversSignal) {
      body += ` ${signal.clause}.`;
    }
  }

  // Append freeform design intent at the very end as a separate clause, so
  // the LoRA trigger phrase + training-distribution structure up front stays
  // clean and base FLUX still picks up "floral design pattern" / "paisley
  // print" / etc. Cap at 3 runs to keep the prompt bounded.
  const uniqFreeform = Array.from(new Set(freeform))
    .filter((s) => s.length > 0)
    .slice(0, 3);
  if (uniqFreeform.length) {
    body += ` Styled with ${uniqFreeform.join(" and ")}.`;
  }

  const finalizePrompt = (triggerPhrase: string): string => {
    let p = `${triggerPhrase} ${body}`.replace(/\s+/g, " ").trim();
    if (p.length > PROMPT_OUTPUT_MAX) {
      p = p.slice(0, PROMPT_OUTPUT_MAX).replace(/[.,\s]+$/, "") + ".";
    }
    return p;
  };
  const frontPrompt = finalizePrompt(TRIGGER_FRONT);
  const backPrompt = finalizePrompt(TRIGGER_BACK);
  const prompt = view === "back" ? backPrompt : frontPrompt;

  const facets: PromptFacets = {
    view,
    fit,
    color,
    garment,
    fabric,
    details: uniqDetails,
    freeform: uniqFreeform,
  };

  log.debug("sanitized", {
    rawLen: raw.length,
    outLen: prompt.length,
    view,
    fit: fitPhrase,
    color,
    garment,
    fabric,
    detailCount: uniqDetails.length,
    freeformCount: uniqFreeform.length,
    freeform: uniqFreeform,
    strippedCount: stripped.length,
    filledFromContext,
  });

  return {
    prompt,
    frontPrompt,
    backPrompt,
    view,
    facets,
    stripped,
    rawNormalized: normalized,
    filledFromContext,
  };
}
