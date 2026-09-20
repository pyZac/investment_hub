"use client";

import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Wallet,
  Coins,
  Package,
  Percent,
  Split,
  Trophy,
  Wrench,
  Activity,
  Scale,
  Receipt,
  ShieldAlert,
  Settings,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ADMIN_NAV_ITEMS = [
  { href: "/admin/overview", labelKey: "overview", icon: LayoutDashboard },
  { href: "/admin/users", labelKey: "users", icon: Users },
  { href: "/admin/sub-admins", labelKey: "subAdmins", icon: ShieldCheck },
  { href: "/admin/withdrawals", labelKey: "withdrawals", icon: Wallet },
  { href: "/admin/credits", labelKey: "credits", icon: Coins },
  { href: "/admin/packages", labelKey: "packages", icon: Package },
  { href: "/admin/interest-rate", labelKey: "interestRate", icon: Percent },
  { href: "/admin/commission-config", labelKey: "commissionConfig", icon: Split },
  { href: "/admin/rank-config", labelKey: "rankConfig", icon: Trophy },
  { href: "/admin/manual-adjustment", labelKey: "manualAdjustment", icon: Wrench },
  { href: "/admin/job-monitor", labelKey: "jobMonitor", icon: Activity },
  { href: "/admin/solvency", labelKey: "solvency", icon: Scale },
  { href: "/admin/ledger", labelKey: "ledger", icon: Receipt },
  { href: "/admin/security-events", labelKey: "securityEvents", icon: ShieldAlert },
  { href: "/admin/settings", labelKey: "settings", icon: Settings },
] as const;

/**
 * All links always render regardless of the acting admin's specific
 * permission grants — this nav only decides what's SHOWN, not what's
 * ALLOWED (invariant #8's enforcement lives in each page.tsx's own
 * requirePermissionOrRedirect/requireMainAdminOrRedirect call, unchanged by
 * this component). A sub-admin without a given permission who clicks its
 * link is redirected by that page exactly as it already was before this
 * nav existed — filtering the nav itself per-grant is a separate, larger
 * feature, not part of "just routing and a nav link."
 */
export function AdminSidebarNav({ className }: { className?: string }) {
  const t = useTranslations("AdminNav");
  const pathname = usePathname();

  return (
    <nav className={cn("flex flex-col gap-1", className)}>
      {ADMIN_NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-11 flex-row items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span>{t(labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
