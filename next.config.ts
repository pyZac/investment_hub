import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isProduction = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy (Phase 12/SCRUM-120, build_plan.md Part 7
 * "Transport & Headers"). `default-src 'self'` as the baseline — this app
 * has no external script/style CDNs at all (next/font/google self-hosts
 * font files at build time into this origin, confirmed by grep: no
 * fonts.googleapis.com/fonts.gstatic.com references anywhere, and no
 * dangerouslySetInnerHTML/inline <script> tags in the codebase), so almost
 * everything can stay 'self'.
 *
 * `script-src`/`style-src` need `'unsafe-inline'` because Next.js's App
 * Router injects inline styles (and, in dev, inline scripts for HMR/error
 * overlay) that cannot be nonce'd without a much larger middleware-based
 * nonce-plumbing change — out of scope for this ticket, and a CSP that
 * silently breaks the app is worse than no CSP (this ticket's own
 * instruction). Dev mode additionally needs `'unsafe-eval'` (webpack's
 * eval-based dev builds) and `ws:`/`wss:` in connect-src (the HMR
 * websocket) — both dropped in production, where Next serves precompiled
 * bundles with no eval and no HMR socket.
 */
function buildCsp(): string {
  const scriptSrc = isProduction ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  const connectSrc = isProduction ? "connect-src 'self'" : "connect-src 'self' ws: wss:";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    connectSrc,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  // Standalone output traces the exact runtime dependency subset into
  // .next/standalone (SCRUM-124) — lets the production Docker image copy a
  // pre-pruned server bundle instead of shipping full node_modules.
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: buildCsp() },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
