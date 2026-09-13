"use client";

import { useTranslations, useFormatter } from "next-intl";
import { Badge } from "@/components/ui/badge";

type RankHistoryRow = {
  id: string;
  rankName: string;
  mrvRequired: string;
  directReferralsRequired: number;
  rewardAmount: string;
  rewardType: "CASH" | "CASH_OR_TRIP";
  rankOrder: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  setByAdminName: string | null;
  createdAt: string;
};

export function RankHistoryList({ initialHistory }: { initialHistory: RankHistoryRow[] }) {
  const t = useTranslations("AdminRankConfig");
  const format = useFormatter();

  if (initialHistory.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/40">
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colRankName")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colMrvRequired")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colReferralsRequired")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colRewardAmount")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colEffectiveFrom")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colEffectiveTo")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colSetBy")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colCreatedAt")}</th>
          </tr>
        </thead>
        <tbody>
          {initialHistory.map((r) => (
            <tr key={r.id} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-2 font-medium">{r.rankName}</td>
              <td className="px-3 py-2 tabular-nums" dir="ltr">
                {r.mrvRequired}
              </td>
              <td className="px-3 py-2 tabular-nums" dir="ltr">
                {r.directReferralsRequired}
              </td>
              <td className="px-3 py-2 tabular-nums" dir="ltr">
                {r.rewardAmount}
              </td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                {format.dateTime(new Date(r.effectiveFrom), { dateStyle: "medium" })}
              </td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                {r.effectiveTo ? (
                  format.dateTime(new Date(r.effectiveTo), { dateStyle: "medium" })
                ) : (
                  <Badge variant="success">{t("statusActive")}</Badge>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{r.setByAdminName ?? t("setBySystem")}</td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                {format.dateTime(new Date(r.createdAt), { dateStyle: "medium", timeStyle: "short" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
