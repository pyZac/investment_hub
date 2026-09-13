import { getTranslations, getLocale } from "next-intl/server";
import { requirePermissionOrRedirect } from "@/lib/page-guard";
import { listRecentManualAdjustments } from "@/lib/manual-adjustment";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AdjustmentFlow } from "./adjustment-flow";
import { RecentAdjustmentsList } from "./recent-adjustments-list";

export default async function AdminManualAdjustmentPage() {
  const t = await getTranslations("AdminManualAdjustment");
  const locale = await getLocale();
  const actor = await requirePermissionOrRedirect("MANUAL_ADJUSTMENT", new Date());

  const adjustments = await listRecentManualAdjustments(actor.id);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("reverseHeading")}</CardTitle>
          <CardDescription>{t("reverseDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <AdjustmentFlow locale={locale} />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("historyHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentAdjustmentsList
            initialAdjustments={adjustments.map((a) => ({
              id: a.id,
              adminName: a.adminName,
              reason: a.reason,
              createdAt: a.createdAt.toISOString(),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
