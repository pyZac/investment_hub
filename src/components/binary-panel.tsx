import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { CountdownRing } from "@/components/countdown-ring";
import type { QualificationFailureReason } from "@/lib/binary-cycle";

export type DashboardBinaryCycle = {
  leftVolume: string;
  rightVolume: string;
  carryLeft: string;
  carryRight: string;
  qualified: boolean;
  qualificationReason: QualificationFailureReason | null;
};

function VolumeBar({
  label,
  value,
  carry,
  carryLabel,
  maxValue,
}: {
  label: string;
  value: string;
  carry: string;
  carryLabel: string;
  maxValue: number;
}) {
  const numeric = Number(value);
  const widthPct = maxValue > 0 ? Math.max((numeric / maxValue) * 100, numeric > 0 ? 2 : 0) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-row items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-brand" style={{ width: `${widthPct}%` }} />
      </div>
      <div className="flex flex-row items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{carryLabel}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{carry}</span>
      </div>
    </div>
  );
}

export async function BinaryPanel({
  cycle,
  daysUntilClose,
}: {
  cycle: DashboardBinaryCycle | null;
  daysUntilClose: number;
}) {
  const t = await getTranslations("Dashboard");
  const tBinary = await getTranslations("BinaryTree");

  const ringLabel = daysUntilClose === 0 ? "✓" : t("ringDaysValue", { days: daysUntilClose });
  const ringVariant = daysUntilClose === 0 ? "complete" : "active";
  const ringSrDescription =
    daysUntilClose === 0
      ? t("binaryCycleCloseSrDescriptionToday")
      : t("binaryCycleCloseSrDescription", { days: daysUntilClose });
  const ringSublabel = daysUntilClose === 0 ? t("binaryCycleCloseRingComplete") : t("binaryCycleCloseRingSublabel");

  if (cycle === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
          <Users className="size-6" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">{tBinary("noCycleHistoryTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{tBinary("noCycleHistoryDescription")}</p>
        </div>
        <CountdownRing
          progress={daysUntilClose === 0 ? 1 : 1 - daysUntilClose / 7}
          variant={ringVariant}
          label={ringLabel}
          sublabel={ringSublabel}
          srDescription={ringSrDescription}
        />
      </div>
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
    <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex-1 space-y-6">
        <div className="flex flex-row flex-wrap items-center gap-3">
          {cycle.qualified ? (
            <Badge variant="success">{tBinary("statusQualified")}</Badge>
          ) : (
            <Badge variant="warning">{tBinary("statusUnqualified")}</Badge>
          )}
        </div>

        {!cycle.qualified && qualificationReasonKey && (
          <p className="text-sm text-warning">{tBinary(qualificationReasonKey)}</p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <VolumeBar
            label={t("binaryLeftLegLabel")}
            value={cycle.leftVolume}
            maxValue={maxValue}
            carry={cycle.carryLeft}
            carryLabel={tBinary("carryForwardLeftLabel")}
          />
          <VolumeBar
            label={t("binaryRightLegLabel")}
            value={cycle.rightVolume}
            maxValue={maxValue}
            carry={cycle.carryRight}
            carryLabel={tBinary("carryForwardRightLabel")}
          />
        </div>
      </div>

      <div className="flex shrink-0 justify-center sm:justify-end">
        <CountdownRing
          progress={daysUntilClose === 0 ? 1 : 1 - daysUntilClose / 7}
          variant={ringVariant}
          label={ringLabel}
          sublabel={ringSublabel}
          srDescription={ringSrDescription}
        />
      </div>
    </div>
  );
}
