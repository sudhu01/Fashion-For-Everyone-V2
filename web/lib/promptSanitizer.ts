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

export interface SanitizedPrompt {
  prompt: string;
  view: "front" | "back";
  stripped: string[];
  rawNormalized: string;
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
  "v-neck","crew-neck","round-neck","hooded","high-neck",
  "long-sleeve","short-sleeve","sleeveless","cuff","cuffs",
  "welt","patch","flap","jetted","kangaroo","chest","hip","inside","rear",
  "pocket","pockets","five-pocket",
  "ribbed","trim","trims","hem","vent","vents","back-vent",
  "zip","zipped","zipper","button","buttons","snap","snap-button",
  "drawstring","waistband","drawcord","elastic","belt",
  "faded","washed","ripped","distressed","contrast","stitched",
  "printed","plain","solid","striped","checked","embroidered",
  "logo","graphic",
]);

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

export function sanitizeAndAugmentPrompt(raw: string): SanitizedPrompt {
  if (typeof raw !== "string") {
    throw new SanitizationError("Prompt must be a string.");
  }
  const normalized = normalize(raw);
  if (normalized.length < 2) {
    throw new SanitizationError("Please describe what you'd like to see.");
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

  for (const tok of rest.split(/[\s,./]+/).filter(Boolean)) {
    if (tok === "front" || tok === "back" || tok === "view" || tok === "side") continue;
    if (tok === "made" || tok === "from" || tok === "with" || tok === "a" || tok === "an" || tok === "the" || tok === "of" || tok === "and" || tok === "in" || tok === "to") continue;
    if (COLORS.has(tok)) { if (!color) color = tok; continue; }
    if (FABRICS.has(tok)) { if (!fabric) fabric = tok; continue; }
    if (DETAIL_WHITELIST.has(tok)) { details.push(tok); continue; }
    stripped.push(tok);
  }

  if (!garment) {
    throw new SanitizationError(
      "Please mention a garment (blazer, jacket, hoodie, shirt, polo, t-shirt, jeans, trousers, shorts, coat, or overshirt).",
    );
  }

  const viewPrefix = view === "back" ? TRIGGER_BACK : TRIGGER_FRONT;
  const fitPhrase = fit ?? "regular fit";
  const fabricPhrase = fabric ? `${fabric} fabric` : "cotton fabric";
  const colorWord = color ? `${color} ` : "";

  let prompt = `${viewPrefix} ${fitPhrase} ${colorWord}${garment} made from ${fabricPhrase}.`;
  if (details.length) {
    const uniq = Array.from(new Set(details)).slice(0, 8);
    prompt += ` featuring ${uniq.join(" ")}.`;
  }
  prompt = prompt.replace(/\s+/g, " ").trim();
  if (prompt.length > PROMPT_OUTPUT_MAX) {
    prompt = prompt.slice(0, PROMPT_OUTPUT_MAX).replace(/[.,\s]+$/, "") + ".";
  }

  log.debug("sanitized", {
    rawLen: raw.length,
    outLen: prompt.length,
    view,
    fit: fitPhrase,
    color,
    garment,
    fabric,
    detailCount: details.length,
    strippedCount: stripped.length,
  });

  return { prompt, view, stripped, rawNormalized: normalized };
}
