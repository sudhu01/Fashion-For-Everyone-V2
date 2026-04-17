/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    // Strict-Transport-Security: only emit in production. In dev we still
    // serve over http://localhost and don't want browsers to cache the HSTS
    // policy against the dev domain.
    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "X-DNS-Prefetch-Control", value: "off" },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          // We currently render generated images via raw <img>. The URL is
          // either a data:image/* URI (regex-validated) or an HTTPS URL from
          // the upstream model (allowlist-checked at extraction time).
          // TODO(pre-prod): tighten `img-src` to the exact upstream CDN
          // hostname(s) once ALLOWED_IMAGE_HOSTS is set.
          "img-src 'self' data: blob: https:",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          // Next.js dev/HMR needs 'unsafe-eval' for React Refresh; prod build does not.
          // 'unsafe-inline' is required for Next.js' inline boot script and
          // Clerk's hydration script. A nonce-based CSP would be stricter
          // but requires plumbing the nonce through Next's <Script> usage.
          // TODO(pre-prod): migrate to nonce-based script-src.
          // Clerk loads its JS bundle from <instance>.clerk.accounts.dev (dev)
          // or clerk.<your-domain> (prod) — we allow both subdomains here.
          // Cloudflare Turnstile is the bot challenge Clerk uses by default.
          `script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
          "worker-src 'self' blob:",
          // Clerk frontend SDK calls *.clerk.accounts.dev / *.clerk.com.
          `connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk-telemetry.com${isDev ? " ws: wss:" : ""}`,
          // Clerk's hosted CAPTCHA / sign-in widgets render in iframes.
          "frame-src 'self' https://challenges.cloudflare.com https://*.clerk.accounts.dev https://*.clerk.com",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
          ...(isDev ? [] : ["upgrade-insecure-requests"]),
        ].join("; "),
      },
    ];
    if (!isDev) {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
module.exports = nextConfig;
