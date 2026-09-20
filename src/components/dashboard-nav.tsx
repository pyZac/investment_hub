"use client";

import {
  LayoutDashboard,
  Package,
  GitBranch,
  Users,
  Wallet,
  Send,
  Receipt,
  UserCircle,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const BASE_NAV_ITEMS = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/packages", labelKey: "invest", icon: Package },
] as const;

/**
 * Marketer-only tabs — a regular (non-marketer) user never sees these links
 * and is redirected to /dashboard if they visit the URLs directly
 * (requireMarketerOrRedirect on each page). Binary Tree existed before the
 * marketer split; Referrals and Ranking are gated the same way per the
 * feature spec, not because they're new — see page-guard.ts.
 */
const MARKETER_NAV_ITEMS = [
  { href: "/binary-tree", labelKey: "binaryTree", icon: GitBranch },
  { href: "/referrals", labelKey: "referrals", icon: Users },
  { href: "/ranking", labelKey: "ranking", icon: Trophy },
] as const;

const TAIL_NAV_ITEMS = [
  { href: "/withdrawals", labelKey: "withdrawals", icon: Wallet },
  { href: "/transfer", labelKey: "transfer", icon: Send },
  { href: "/transactions", labelKey: "transactions", icon: Receipt },
  { href: "/dashboard/profile", labelKey: "profile", icon: UserCircle },
] as const;

export function DashboardNav({
  className,
  isAdmin,
  isMarketer,
}: {
  className?: string;
  isAdmin?: boolean;
  isMarketer?: boolean;
}) {
  const t = useTranslations("Nav");
  const pathname = usePathname();

  const navItems = [...BASE_NAV_ITEMS, ...(isMarketer ? MARKETER_NAV_ITEMS : []), ...TAIL_NAV_ITEMS];

  return (
    <nav className={cn("flex flex-row flex-wrap items-center gap-1", className)}>
      {navItems.map(({ href, labelKey, icon: Icon }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-11 flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
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
            "flex min-h-11 flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
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
