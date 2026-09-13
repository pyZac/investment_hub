"use client";

import { LayoutDashboard, GitBranch, Users, Wallet, Receipt, UserCircle, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/binary-tree", labelKey: "binaryTree", icon: GitBranch },
  { href: "/referrals", labelKey: "referrals", icon: Users },
  { href: "/withdrawals", labelKey: "withdrawals", icon: Wallet },
  { href: "/transactions", labelKey: "transactions", icon: Receipt },
  { href: "/dashboard/profile", labelKey: "profile", icon: UserCircle },
] as const;

export function DashboardNav({ className, isAdmin }: { className?: string; isAdmin?: boolean }) {
  const t = useTranslations("Nav");
  const pathname = usePathname();

  return (
    <nav className={cn("flex flex-row flex-wrap items-center gap-1", className)}>
      {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span>{t(labelKey)}</span>
          </Link>
        );
      })}
      {isAdmin ? (
        <Link
          href="/admin/users"
          className={cn(
            "flex flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
            pathname.startsWith("/admin")
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          <ShieldCheck className="size-4 shrink-0" />
          <span>{t("adminPanel")}</span>
        </Link>
      ) : null}
    </nav>
  );
}
