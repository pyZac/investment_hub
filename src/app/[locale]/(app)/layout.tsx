import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LogoMark } from "@/components/logo";
import { DashboardNav } from "@/components/dashboard-nav";
import { LogoutButton } from "@/components/logout-button";
import { Link } from "@/i18n/navigation";
import { SESSION_COOKIE_NAME, validateAndTouchSession } from "@/lib/session";

/**
 * The user-dashboard header (Dashboard/Binary Tree/.../Admin Panel link),
 * moved verbatim out of the parent `[locale]/layout.tsx` — see that file's
 * comment for why. Applies to every page in this `(app)` route group only
 * (dashboard, binary-tree, investments, login, packages, referrals,
 * register, transactions, withdrawals, preview, the root page) — never to
 * `/admin/*`, which has its own sibling layout with a completely different
 * sidebar nav.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const sessionUser = sessionToken ? await validateAndTouchSession(sessionToken, new Date()) : null;
  const hasSession = Boolean(sessionUser);
  const isAdmin = sessionUser?.role === "ADMIN";

  return (
    <>
      {hasSession ? (
        <header className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-row flex-wrap items-center justify-between gap-3 px-6 py-3 lg:px-8">
            <div className="flex flex-row items-center gap-6">
              <Link href="/dashboard" className="flex shrink-0 items-center">
                <LogoMark />
              </Link>
              <DashboardNav isAdmin={isAdmin} />
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
    </>
  );
}
