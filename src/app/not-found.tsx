/**
 * Renders under the root layout (src/app/layout.tsx) for any route that
 * doesn't match even a locale segment — e.g. bare /admin with no page.tsx
 * there. There is no resolved locale at this point (that's the definition
 * of "unmatched"), so this can't use next-intl/useTranslations the way
 * src/app/[locale]/not-found.tsx does for a within-locale 404 — it's a
 * plain bilingual-by-hardcoding fallback shown only in this one edge case.
 */
export default function RootNotFound() {
  return (
    <div
      style={{
        minHeight: "100svh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        padding: "0 1.5rem",
        textAlign: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Page not found / الصفحة غير موجودة</h1>
      <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- no resolved locale exists at this boundary, so next-intl's locale-aware Link can't be used here */}
      <a href="/en/dashboard" style={{ fontSize: "0.875rem", fontWeight: 500, textDecoration: "underline" }}>
        Go to dashboard
      </a>
    </div>
  );
}
