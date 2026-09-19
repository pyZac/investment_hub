import { Trophy } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";

export type DashboardRankProgress = {
  currentRankName: string | null;
  nextRankName: string | null;
  mrvRequired: string | null;
  directReferralsRequired: number | null;
  currentMrv: string;
  currentReferralCount: number;
};

function ProgressBar({
  label,
  currentDisplay,
  thresholdDisplay,
  widthPct,
}: {
  label: string;
  currentDisplay: string;
  thresholdDisplay: string;
  widthPct: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-row items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-semibold tabular-nums" dir="ltr">
          {currentDisplay} / {thresholdDisplay}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-brand" style={{ width: `${widthPct}%` }} />
      </div>
    </div>
  );
}

export async function RankProgressPanel({ progress }: { progress: DashboardRankProgress }) {
  const t = await getTranslations("Dashboard");

  const rankBadgeLabel = progress.currentRankName ?? t("rankUnranked");

  if (progress.nextRankName === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <Badge variant="outline" className="text-sm">
          {rankBadgeLabel}
        </Badge>
        <div className="flex size-12 items-center justify-center rounded-full bg-brand/10 text-brand">
          <Trophy className="size-6" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("rankMaxAchieved")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("rankMaxAchievedDescription")}</p>
        </div>
      </div>
    );
  }

  const mrvNumeric = Number(progress.currentMrv);
  const mrvThresholdNumeric = Number(progress.mrvRequired);
  const mrvWidthPct =
    mrvThresholdNumeric > 0 ? Math.min((mrvNumeric / mrvThresholdNumeric) * 100, 100) : 0;

  const referralsThreshold = progress.directReferralsRequired ?? 0;
  const referralsWidthPct =
    referralsThreshold > 0 ? Math.min((progress.currentReferralCount / referralsThreshold) * 100, 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <Badge variant="outline" className="text-sm">
          {rankBadgeLabel}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {t("rankNextLabel", { rank: progress.nextRankName })}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ProgressBar
          label={t("rankMrvBarLabel")}
          currentDisplay={progress.currentMrv}
          thresholdDisplay={progress.mrvRequired ?? "0"}
          widthPct={mrvWidthPct}
        />
        <ProgressBar
          label={t("rankReferralsBarLabel")}
          currentDisplay={String(progress.currentReferralCount)}
          thresholdDisplay={String(referralsThreshold)}
          widthPct={referralsWidthPct}
        />
      </div>
    </div>
  );
}
