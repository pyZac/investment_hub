import { getTranslations, getLocale } from "next-intl/server";
import { requirePermissionOrRedirect } from "@/lib/page-guard";
import { getCurrentCommissionConfig, listCommissionConfigHistory } from "@/lib/commission-config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CurrentConfigCard } from "./current-config-card";
import { SetConfigForm } from "./set-config-form";
import { ConfigHistoryList } from "./config-history-list";

export default async function AdminCommissionConfigPage() {
  const t = await getTranslations("AdminCommissionConfig");
  const locale = await getLocale();
  const actor = await requirePermissionOrRedirect("COMMISSION_CONFIG", new Date());

  const [current, history] = await Promise.all([
    getCurrentCommissionConfig(actor.id, new Date()),
    listCommissionConfigHistory(actor.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <CurrentConfigCard
        initialConfig={
          current
            ? {
                directRate: current.directRate.toString(),
                directCommissionSplit: current.directCommissionSplit.toString(),
                directSavingSplit: current.directSavingSplit.toString(),
                binaryRate: current.binaryRate.toString(),
                binaryCarryForwardExpiryMonths: current.binaryCarryForwardExpiryMonths,
                effectiveFrom: current.effectiveFrom.toISOString(),
                setByAdminName: current.setByAdmin?.name ?? null,
              }
            : null
        }
      />

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("setHeading")}</CardTitle>
          <CardDescription>{t("setDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SetConfigForm locale={locale} />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("historyHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ConfigHistoryList
            initialHistory={history.map((r) => ({
              id: r.id,
              directRate: r.directRate.toString(),
              directCommissionSplit: r.directCommissionSplit.toString(),
              directSavingSplit: r.directSavingSplit.toString(),
              binaryRate: r.binaryRate.toString(),
              binaryCarryForwardExpiryMonths: r.binaryCarryForwardExpiryMonths,
              effectiveFrom: r.effectiveFrom.toISOString(),
              effectiveTo: r.effectiveTo?.toISOString() ?? null,
              setByAdminName: r.setByAdmin?.name ?? null,
              createdAt: r.createdAt.toISOString(),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
