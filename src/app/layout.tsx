import type { ReactNode } from "react";

/**
 * This layout is only ever reached directly for a genuinely unmatched route
 * (e.g. bare /admin with no page.tsx there) — Next.js always resolves its
 * root not-found.tsx under THIS layout, never under
 * src/app/[locale]/layout.tsx, even though every real page lives under the
 * [locale] segment. Previously this returned bare `children` with no
 * <html>/<body> at all (those only existed in the nested [locale] layout),
 * which crashed with "Missing <html> and <body> tags in the root layout" the
 * moment a route missed every segment match. This minimal wrapper (no nav,
 * no next-intl — a truly unmatched route has no known locale to render in)
 * is the fallback shell; src/app/not-found.tsx is the only page rendered
 * inside it.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
