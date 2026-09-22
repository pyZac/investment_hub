"use client";

import { useTranslations } from "next-intl";
import { LogoMark } from "@/components/logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileNavSheet } from "@/components/mobile-nav-sheet";
import { Link, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", labelKey: "navHome" },
  { href: "/about", labelKey: "navAbout" },
  { href: "/how-we-invest", labelKey: "navHowWeInvest" },
  { href: "/sectors", labelKey: "navSectors" },
] as const;

function PublicNavLinks({ className }: { className?: string }) {
  const t = useTranslations("Public");
  const pathname = usePathname();

  return (
    <nav className={cn("flex flex-row flex-wrap items-center gap-1", className)}>
      {NAV_ITEMS.map(({ href, labelKey }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-11 flex-row items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {t(labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Shared header for every public (pre-login) page — never rendered on
 * `/dashboard`, `/admin/*`, or any other `(app)` route, which keep their own
 * headers (`(app)/layout.tsx`'s DashboardNav, `admin/layout.tsx`'s sidebar).
 * Sticky per the spec; reuses the existing `MobileNavSheet` primitive for the
 * hamburger menu (same pattern as the dashboard header) rather than a new
 * drawer implementation.
 */
export function PublicHeader() {
  const t = useTranslations("Public");

  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-row items-center justify-between gap-3 px-6 py-3 lg:px-8">
        <div className="flex flex-row items-center gap-8">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" dir="ltr">
            <LogoMark />
            <span className="font-heading text-lg leading-none font-semibold tracking-[0.1em] text-brand">
              INVESTA
            </span>
          </Link>
          <PublicNavLinks className="hidden lg:flex" />
        </div>
        <div className="hidden flex-row items-center gap-2 lg:flex">
          <LanguageSwitcher />
          <Button nativeButton={false} render={<Link href="/login" />}>
            {t("navLogin")}
          </Button>
        </div>
        <MobileNavSheet title={t("navHome")} triggerLabel={t("openMenu")}>
          <PublicNavLinks className="flex-col items-stretch" />
          <div className="mt-4 flex flex-col gap-3 border-t border-border/60 pt-4">
            <LanguageSwitcher />
            <Button className="w-full" nativeButton={false} render={<Link href="/login" />}>
              {t("navLogin")}
            </Button>
          </div>
        </MobileNavSheet>
      </div>
    </header>
  );
}
