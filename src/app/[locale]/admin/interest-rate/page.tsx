import { getTranslations, getLocale } from "next-intl/server";
import { requirePermissionOrRedirect } from "@/lib/page-guard";
import { getCurrentRate, listRateHistory } from "@/lib/rate-config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CurrentRateCard } from "./current-rate-card";
import { SetRateForm } from "./set-rate-form";
import { RateHistoryList } from "./rate-history-list";

export default async function AdminInterestRatePage() {
  const t = await getTranslations("AdminRateConfig");
  const locale = await getLocale();
  const actor = await requirePermissionOrRedirect("RATE_CONFIG", new Date());

  const [current, history] = await Promise.all([getCurrentRate(actor.id, new Date()), listRateHistory(actor.id)]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <CurrentRateCard
        initialRate={
          current
            ? {
                monthlyRate: current.monthlyRate.toString(),
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
          <SetRateForm locale={locale} />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("historyHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <RateHistoryList
            initialHistory={history.map((r) => ({
              id: r.id,
              monthlyRate: r.monthlyRate.toString(),
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
