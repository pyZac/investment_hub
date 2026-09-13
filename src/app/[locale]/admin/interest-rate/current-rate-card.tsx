"use client";

import { useTranslations, useFormatter } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CurrentRate = { monthlyRate: string; effectiveFrom: string; setByAdminName: string | null } | null;

export function CurrentRateCard({ initialRate }: { initialRate: CurrentRate }) {
  const t = useTranslations("AdminRateConfig");
  const format = useFormatter();

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-base font-medium">{t("currentHeading")}</CardTitle>
      </CardHeader>
      <CardContent>
        {initialRate ? (
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-xs text-muted-foreground">{t("currentRateLabel")}</p>
              <p className="font-heading text-2xl font-semibold tabular-nums" dir="ltr">
                {initialRate.monthlyRate}%
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("effectiveSinceLabel")}</p>
              <p className="font-heading text-base font-medium tabular-nums">
                {format.dateTime(new Date(initialRate.effectiveFrom), { dateStyle: "medium" })}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("setByLabel")}</p>
              <p className="text-sm font-medium">{initialRate.setByAdminName ?? t("setBySystem")}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noActiveRate")}</p>
        )}
      </CardContent>
    </Card>
  );
}
