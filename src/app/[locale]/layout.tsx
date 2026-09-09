import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LogoMark } from "@/components/logo";
import { DashboardNav } from "@/components/dashboard-nav";
import { LogoutButton } from "@/components/logout-button";
import { Link } from "@/i18n/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/session";
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

  const hasSession = Boolean((await cookies()).get(SESSION_COOKIE_NAME)?.value);

  return (
    <html
      lang={locale}
      dir={dirByLocale[locale]}
      className={`${fontSans.variable} ${fontHeading.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          {hasSession ? (
            <header className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur">
              <div className="mx-auto flex max-w-6xl flex-row flex-wrap items-center justify-between gap-3 px-6 py-3 lg:px-8">
                <div className="flex flex-row items-center gap-6">
                  <Link href="/dashboard" className="flex shrink-0 items-center">
                    <LogoMark />
                  </Link>
                  <DashboardNav />
                </div>
                <div className="flex flex-row items-center gap-2">
                  <LanguageSwitcher />
                  <LogoutButton />
                </div>
              </div>
            </header>
          ) : (
            <header className="flex justify-end p-4">
              <LanguageSwitcher />
            </header>
          )}
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
