import { getTranslations, getLocale } from "next-intl/server";
import { requirePermissionOrRedirect } from "@/lib/page-guard";
import { listRankConfigs, listRankConfigHistory } from "@/lib/rank";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toDisplayWithCurrency } from "@/lib/display";
import { RankList } from "./rank-list";
import { AddRankForm } from "./add-rank-form";
import { RankHistoryList } from "./rank-history-list";

export default async function AdminRankConfigPage() {
  const t = await getTranslations("AdminRankConfig");
  const locale = await getLocale();
  const actor = await requirePermissionOrRedirect("RANK_CONFIG", new Date());

  const [ranks, history] = await Promise.all([listRankConfigs(actor.id), listRankConfigHistory(actor.id)]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("listHeading")}</CardTitle>
          <CardDescription>{t("listDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <RankList
            locale={locale}
            initialRanks={ranks.map((r) => ({
              id: r.id,
              rankName: r.rankName,
              mrvRequired: r.mrvRequired.toString(),
              directReferralsRequired: r.directReferralsRequired,
              rewardAmount: r.rewardAmount.toString(),
              rewardType: r.rewardType,
              rankOrder: r.rankOrder,
              effectiveFrom: r.effectiveFrom.toISOString(),
              achievedByAnyUser: r.achievedByAnyUser,
              setByAdminName: r.setByAdminName,
            }))}
          />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("addHeading")}</CardTitle>
          <CardDescription>{t("addDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <AddRankForm locale={locale} />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("historyHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <RankHistoryList
            initialHistory={history.map((r) => ({
              id: r.id,
              rankName: r.rankName,
              mrvRequired: toDisplayWithCurrency(r.mrvRequired),
              directReferralsRequired: r.directReferralsRequired,
              rewardAmount: toDisplayWithCurrency(r.rewardAmount),
              rewardType: r.rewardType,
              rankOrder: r.rankOrder,
              effectiveFrom: r.effectiveFrom.toISOString(),
              effectiveTo: r.effectiveTo?.toISOString() ?? null,
              setByAdminName: r.setByAdminName,
              createdAt: r.createdAt.toISOString(),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
