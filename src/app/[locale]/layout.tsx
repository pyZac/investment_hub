import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { fontHeading, fontSans } from "@/lib/fonts";
import "../globals.css";

export const metadata: Metadata = {
  title: "Investa",
  description: "Internal investment simulation platform",
};

const dirByLocale: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  ar: "rtl",
};

/**
 * Shell-only: `<html>`/`<body>`/`NextIntlClientProvider`. No header, no nav
 * — those are owned by the two sibling layouts nested inside this one,
 * `(app)/layout.tsx` (the user dashboard header) and `admin/layout.tsx`
 * (the admin sidebar), which render completely different chrome and must
 * never leak into each other. Previously this layout rendered the user
 * -dashboard header directly, which meant every `/admin/*` page inherited
 * it too (normal Next.js layout nesting) with no way to opt out — fixed by
 * moving that header down into `(app)/layout.tsx`, a route group that
 * changes no URLs (existing user-facing pages moved into it as-is).
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  return (
    <html
      lang={locale}
      dir={dirByLocale[locale]}
      className={`${fontSans.variable} ${fontHeading.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
