"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSolvencyOverviewAction, type SolvencyOverviewRow } from "./actions";

function ratioPercent(ratio: string | null): string | null {
  if (ratio === null) return null;
  return (Number(ratio) * 100).toFixed(2);
}

export function SolvencyOverviewCard({ initialOverview }: { initialOverview: SolvencyOverviewRow }) {
  const t = useTranslations("AdminSolvency");
  const [overview, setOverview] = useState(initialOverview);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const result = await getSolvencyOverviewAction();
      if (result.ok) {
        setOverview(result.overview);
      }
    });
  }

  const ratioPct = ratioPercent(overview.solvencyRatio);
  const isOverIssued = ratioPct !== null && Number(ratioPct) > 100;
  const isUnderIssued = ratioPct !== null && Number(ratioPct) < 100;

  return (
    <div className="space-y-6">
      <div className="flex flex-row justify-end">
        <Button size="sm" variant="outline" className="cursor-pointer" disabled={isPending} onClick={refresh}>
          <RefreshCw className={`size-3.5 shrink-0 ${isPending ? "animate-spin" : ""}`} aria-hidden="true" />
          <span>{t("refresh")}</span>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base font-medium">{t("totalCreditIssuedHeading")}</CardTitle>
            <CardDescription>{t("totalCreditIssuedDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold tabular-nums" dir="ltr">
              {overview.totalCreditIssued}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base font-medium">{t("totalLiabilitiesHeading")}</CardTitle>
            <CardDescription>{t("totalLiabilitiesDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="font-heading text-3xl font-semibold tabular-nums" dir="ltr">
              {overview.totalLiabilities}
            </p>
            <div className="space-y-1 text-sm text-muted-foreground">
              <div className="flex flex-row items-center justify-between gap-2">
                <span dir="ltr">Wallet A</span>
                <span className="tabular-nums" dir="ltr">
                  {overview.liabilitiesBreakdown.walletA}
                </span>
              </div>
              <div className="flex flex-row items-center justify-between gap-2">
                <span dir="ltr">Wallet B</span>
                <span className="tabular-nums" dir="ltr">
                  {overview.liabilitiesBreakdown.walletB}
                </span>
              </div>
              <div className="flex flex-row items-center justify-between gap-2">
                <span dir="ltr">Wallet C</span>
                <span className="tabular-nums" dir="ltr">
                  {overview.liabilitiesBreakdown.walletC}
                </span>
              </div>
              <div className="flex flex-row items-center justify-between gap-2">
                <span dir="ltr">Wallet SAVING</span>
                <span className="tabular-nums" dir="ltr">
                  {overview.liabilitiesBreakdown.walletSaving}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("ratioHeading")}</CardTitle>
          <CardDescription>{t("ratioDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {ratioPct === null ? (
            <p className="text-sm text-muted-foreground">{t("ratioUndefined")}</p>
          ) : (
            <div className="flex flex-row items-center gap-3">
              <p className="font-heading text-3xl font-semibold tabular-nums" dir="ltr">
                {ratioPct}%
              </p>
              <Badge variant={isOverIssued ? "warning" : isUnderIssued ? "success" : "secondary"}>
                {isOverIssued ? t("ratioOverIssued") : isUnderIssued ? t("ratioUnderIssued") : t("ratioExact")}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("projectionHeading")}</CardTitle>
          <CardDescription>{t("projectionDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="font-heading text-3xl font-semibold tabular-nums" dir="ltr">
            {overview.projectedLiabilities30d}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t("projectionEstimateNotice")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
