import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";

export type RankLadderRow = {
  id: string;
  rankName: string;
  mrvRequired: string;
  directReferralsRequired: number;
  rewardAmount: string;
  rewardType: "CASH" | "CASH_OR_TRIP";
  rankOrder: number;
};

export async function RankLadder({
  ranks,
  currentRankName,
}: {
  ranks: RankLadderRow[];
  currentRankName: string | null;
}) {
  const t = await getTranslations("Ranking");

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/40">
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colRankName")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colMrvRequired")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">
              {t("colReferralsRequired")}
            </th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colReward")}</th>
          </tr>
        </thead>
        <tbody>
          {ranks.map((rank) => {
            const isCurrent = rank.rankName === currentRankName;
            return (
              <tr
                key={rank.id}
                className={
                  isCurrent
                    ? "border-b border-border/40 bg-brand/5 last:border-0"
                    : "border-b border-border/40 last:border-0"
                }
              >
                <td className="px-3 py-2">
                  <div className="flex flex-row flex-wrap items-center gap-2">
                    <span className="font-medium" dir="ltr">
                      {rank.rankName}
                    </span>
                    {isCurrent && <Badge variant="success">{t("currentRankBadge")}</Badge>}
                  </div>
                </td>
                <td className="px-3 py-2 font-heading font-semibold tabular-nums" dir="ltr">
                  {rank.mrvRequired}
                </td>
                <td className="px-3 py-2 tabular-nums" dir="ltr">
                  {rank.directReferralsRequired}
                </td>
                <td className="px-3 py-2 tabular-nums" dir="ltr">
                  {rank.rewardAmount}
                  {rank.rewardType === "CASH_OR_TRIP" && (
                    <span className="ms-1.5 text-xs text-muted-foreground">({t("cashOrTrip")})</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
