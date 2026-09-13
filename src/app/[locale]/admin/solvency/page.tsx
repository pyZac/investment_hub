import { getTranslations } from "next-intl/server";
import { requirePermissionOrRedirect } from "@/lib/page-guard";
import { getSolvencyOverview } from "@/lib/solvency";
import { SolvencyOverviewCard } from "./solvency-overview";

export default async function AdminSolvencyPage() {
  const t = await getTranslations("AdminSolvency");
  const actor = await requirePermissionOrRedirect("SOLVENCY_VIEW", new Date());

  const overview = await getSolvencyOverview(actor.id, new Date());

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <SolvencyOverviewCard
        initialOverview={{
          totalCreditIssued: overview.totalCreditIssued.toString(),
          totalLiabilities: overview.totalLiabilities.toString(),
          liabilitiesBreakdown: {
            walletA: overview.liabilitiesBreakdown.walletA.toString(),
            walletB: overview.liabilitiesBreakdown.walletB.toString(),
            walletC: overview.liabilitiesBreakdown.walletC.toString(),
            walletSaving: overview.liabilitiesBreakdown.walletSaving.toString(),
          },
          solvencyRatio: overview.solvencyRatio?.toString() ?? null,
          projectedLiabilities30d: overview.projectedLiabilities30d.toString(),
        }}
      />
    </div>
  );
}
