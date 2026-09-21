"use client";

import { useTranslations } from "next-intl";
import { CalendarClock, CheckCircle2, AlertTriangle, History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { QualificationFailureReason } from "@/lib/binary-cycle";
import { toDisplayWithCurrency } from "@/lib/display";

export type LatestBinaryCycle = {
  weekStart: string;
  weekEnd: string;
  leftVolume: string;
  rightVolume: string;
  matchedVolume: string;
  commissionPaid: string;
  carryLeft: string;
  carryRight: string;
  qualified: boolean;
  qualificationReason: QualificationFailureReason | null;
};

function VolumeBar({
  label,
  value,
  maxValue,
  colorClassName,
}: {
  label: string;
  value: string;
  maxValue: number;
  colorClassName: string;
}) {
  const numeric = Number(value);
  const widthPct = maxValue > 0 ? Math.max((numeric / maxValue) * 100, numeric > 0 ? 2 : 0) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-row items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-semibold tabular-nums" dir="ltr">
          {toDisplayWithCurrency(value)}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${colorClassName}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}

export function BinaryPanel({ cycle, daysUntilClose }: { cycle: LatestBinaryCycle | null; daysUntilClose: number }) {
  const t = useTranslations("BinaryTree");

  const closeCountdownLabel = daysUntilClose === 0 ? t("cycleClosesToday") : t("cycleClosesInDays", { days: daysUntilClose });

  if (cycle === null) {
    return (
      <Card className="border-border/60 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <History className="size-10 text-muted-foreground/60" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-base font-medium">{t("noCycleHistoryTitle")}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t("noCycleHistoryDescription")}</p>
          </div>
          <div className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
            <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
            <span>{closeCountdownLabel}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxValue = Math.max(Number(cycle.leftVolume), Number(cycle.rightVolume));
  const qualificationReasonKey =
    cycle.qualificationReason === "account_suspended"
      ? "reasonAccountSuspended"
      : cycle.qualificationReason === "no_active_investment"
        ? "reasonNoActiveInvestment"
        : cycle.qualificationReason === "left_leg_inactive"
          ? "reasonLeftLegInactive"
          : cycle.qualificationReason === "right_leg_inactive"
            ? "reasonRightLegInactive"
            : null;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="space-y-6 py-6">
        <div className="flex flex-row flex-wrap items-center justify-between gap-3">
          {cycle.qualified ? (
            <Badge className="bg-emerald-600 text-white dark:bg-emerald-500">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              {t("statusQualified")}
            </Badge>
          ) : (
            <Badge className="bg-amber-600 text-white dark:bg-amber-500">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {t("statusUnqualified")}
            </Badge>
          )}
          <div className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
            <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
            <span>{closeCountdownLabel}</span>
          </div>
        </div>

        {!cycle.qualified && qualificationReasonKey && (
          <p className="text-sm text-amber-700 dark:text-amber-400">{t(qualificationReasonKey)}</p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <VolumeBar label="LEFT" value={cycle.leftVolume} maxValue={maxValue} colorClassName="bg-primary" />
          <VolumeBar label="RIGHT" value={cycle.rightVolume} maxValue={maxValue} colorClassName="bg-primary" />
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-border/60 pt-4 sm:grid-cols-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("matchedVolumeLabel")}</p>
            <p className="text-lg font-semibold tabular-nums" dir="ltr">
              {toDisplayWithCurrency(cycle.matchedVolume)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("commissionPaidLabel")}</p>
            <p className="text-lg font-semibold tabular-nums" dir="ltr">
              {toDisplayWithCurrency(cycle.commissionPaid)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("carryForwardLeftLabel")}</p>
            <p className="text-lg font-semibold tabular-nums" dir="ltr">
              {toDisplayWithCurrency(cycle.carryLeft)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("carryForwardRightLabel")}</p>
            <p className="text-lg font-semibold tabular-nums" dir="ltr">
              {toDisplayWithCurrency(cycle.carryRight)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
