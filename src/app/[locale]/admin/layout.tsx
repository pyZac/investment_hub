import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LogoFull } from "@/components/logo";
import { LogoutButton } from "@/components/logout-button";
import { AdminSidebarNav } from "@/components/admin-sidebar-nav";
import { Link } from "@/i18n/navigation";

/**
 * The dedicated admin shell (SCRUM-116-equivalent bugfix): a sidebar with
 * links to all 12 admin screens, completely separate from the user
 * -dashboard header in `(app)/layout.tsx` — the two are sibling layouts
 * under `[locale]/layout.tsx` (shell-only, no chrome of its own), so
 * neither leaks into the other by construction, not by a conditional check.
 * This layout does NOT gate access itself — every admin page.tsx already
 * calls requirePermissionOrRedirect/requireMainAdminOrRedirect (invariant
 * #8's real enforcement point); this is nav chrome only.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("AdminNav");

  return (
    <div className="flex min-h-full flex-1 flex-row">
      <aside className="flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="border-b border-sidebar-border px-5 py-5">
          <Link href="/admin/users" className="flex shrink-0 items-center">
            <LogoFull tagline={false} />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <AdminSidebarNav />
        </div>
        <div className="flex flex-col gap-2 border-t border-sidebar-border px-3 py-4">
          <p className="px-1 text-xs font-medium tracking-wide text-sidebar-foreground/50 uppercase">
            {t("shellLabel")}
          </p>
          <div className="flex flex-row items-center justify-between gap-2">
            <div className="[&_select]:bg-sidebar-accent [&_select]:text-sidebar-foreground [&_select]:border-sidebar-border">
              <LanguageSwitcher />
            </div>
            <LogoutButton className="text-sidebar-foreground/70 hover:text-sidebar-foreground" />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 bg-background">{children}</main>
    </div>
  );
}
