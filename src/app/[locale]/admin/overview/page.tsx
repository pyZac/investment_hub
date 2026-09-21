import { getTranslations, getLocale } from "next-intl/server";
import { requireMainAdminOrRedirect } from "@/lib/page-guard";
import { getAdminOverview } from "@/lib/admin-overview";
import { toDisplayWithCurrency } from "@/lib/display";
import { InvestmentsOverviewSection } from "./investments-overview-section";
import { FinancialHealthSection } from "./financial-health-section";
import { UserActivitySection } from "./user-activity-section";
import { JobHealthSection } from "./job-health-section";

export default async function AdminOverviewPage() {
  const t = await getTranslations("AdminOverview");
  const locale = await getLocale();
  const actor = await requireMainAdminOrRedirect(new Date());

  const overview = await getAdminOverview(actor.id, new Date());

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <InvestmentsOverviewSection
        activeCount={overview.investments.activeCount}
        activeTotalValue={toDisplayWithCurrency(overview.investments.activeTotalValue)}
        totalLockedCapital={toDisplayWithCurrency(overview.investments.totalLockedCapital)}
        byPackage={overview.investments.byPackage.map((row) => ({
          packageId: row.packageId,
          packageName: row.packageName,
          investmentCount: row.investmentCount,
          totalValue: toDisplayWithCurrency(row.totalValue),
        }))}
        upcomingReleases={overview.investments.upcomingReleases.map((row) => ({
          investmentId: row.investmentId,
          userName: row.userName,
          packageName: row.packageName,
          amount: toDisplayWithCurrency(row.amount),
          capitalUnlocksAt: row.capitalUnlocksAt.toISOString(),
        }))}
        locale={locale}
      />

      <FinancialHealthSection
        totalCreditIssued={toDisplayWithCurrency(overview.financialHealth.totalCreditIssued)}
        totalLiabilities={toDisplayWithCurrency(overview.financialHealth.totalLiabilities)}
        solvencyRatio={overview.financialHealth.solvencyRatio?.toString() ?? null}
      />

      <UserActivitySection
        totalUsers={overview.userActivity.totalUsers}
        totalMarketers={overview.userActivity.totalMarketers}
        totalSuspended={overview.userActivity.totalSuspended}
        newThisMonth={overview.userActivity.newThisMonth}
      />

      <JobHealthSection jobs={overview.jobs} />
    </div>
  );
}
