"use client";

import { useTranslations, useFormatter } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CurrentConfig = {
  directRate: string;
  directCommissionSplit: string;
  directSavingSplit: string;
  binaryRate: string;
  binaryCarryForwardExpiryMonths: number;
  effectiveFrom: string;
  setByAdminName: string | null;
} | null;

export function CurrentConfigCard({ initialConfig }: { initialConfig: CurrentConfig }) {
  const t = useTranslations("AdminCommissionConfig");
  const format = useFormatter();

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-base font-medium">{t("currentHeading")}</CardTitle>
      </CardHeader>
      <CardContent>
        {initialConfig ? (
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-xs text-muted-foreground">{t("directRateLabel")}</p>
              <p className="font-heading text-2xl font-semibold tabular-nums" dir="ltr">
                {initialConfig.directRate}%
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("directSplitLabel")}</p>
              <p className="font-heading text-base font-medium tabular-nums" dir="ltr">
                {initialConfig.directCommissionSplit}% / {initialConfig.directSavingSplit}%
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("binaryRateLabel")}</p>
              <p className="font-heading text-2xl font-semibold tabular-nums" dir="ltr">
                {initialConfig.binaryRate}%
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("carryForwardExpiryLabel")}</p>
              <p className="font-heading text-base font-medium tabular-nums" dir="ltr">
                {initialConfig.binaryCarryForwardExpiryMonths}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("effectiveSinceLabel")}</p>
              <p className="font-heading text-base font-medium tabular-nums">
                {format.dateTime(new Date(initialConfig.effectiveFrom), { dateStyle: "medium" })}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("setByLabel")}</p>
              <p className="text-sm font-medium">{initialConfig.setByAdminName ?? t("setBySystem")}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noActiveConfig")}</p>
        )}
      </CardContent>
    </Card>
  );
}
