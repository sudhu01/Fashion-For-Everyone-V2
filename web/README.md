# Fashion For Everyone — Web

Next.js 14 + Tailwind chatbot that generates fashion looks via FLUX.2 Klein +
a custom Fashion For Everyone LoRA, served through fal.ai.

## Setup

```bash
cd web
cp .env.example .env.local   # fill in FAL_KEY, FAL_MODEL_ID, LORA_URL
npm install
npm run dev
```

Open http://localhost:3000.

## Architecture

- `app/page.tsx` — client shell: sidebar, chat, input.
- `app/api/generate/route.ts` — server-only fal.ai proxy. The API key never
  leaves the server. Validates prompt, rate-limits per user, enforces origin,
  strips unsafe image URL schemes.
- `lib/generation.ts` — single integration point with fal.ai (queue + poll +
  response extraction).
- `lib/promptSanitizer.ts` — rewrites raw user input into the LoRA's training
  distribution ("front view of …" / "back view of …" with fit + garment +
  fabric + details). Derived from the captions in `/final_dataset`.
- `lib/storage.ts` — chat history stored in `localStorage` (per-device).
- `components/Sidebar.tsx` — collapsible, recent-first chat list.

## Security

- fal.ai credentials live only in server env (`process.env.*`).
- Strict CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, no `powered-by`.
- User prompts are sanitized server-side before ever hitting the model:
  injection attempts, NSFW, non-fashion, and out-of-distribution requests are
  rejected with a 400. See `lib/promptSanitizer.ts`.
- Input also length-capped (2000 chars) and stripped of control chars by zod.
- Per-user token-bucket rate limit on generate routes.
- Origin header checked against Host to reduce cross-site POSTs.
- Only `https:` and `data:image/*` URLs (from an optional allowlist) are
  passed through to the client.
