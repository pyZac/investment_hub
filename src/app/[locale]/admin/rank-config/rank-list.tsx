"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listRankConfigsAction, type RankActionErrorKey } from "./actions";
import { EditRankDialog } from "./edit-rank-dialog";

export type RankRow = {
  id: string;
  rankName: string;
  mrvRequired: string;
  directReferralsRequired: number;
  rewardAmount: string;
  rewardType: "CASH" | "CASH_OR_TRIP";
  rankOrder: number;
  effectiveFrom: string;
  achievedByAnyUser: boolean;
  setByAdminName: string | null;
};

export function RankList({ initialRanks, locale }: { initialRanks: RankRow[]; locale: string }) {
  const t = useTranslations("AdminRankConfig");
  const [ranks, setRanks] = useState(initialRanks);
  const [editTarget, setEditTarget] = useState<RankRow | null>(null);
  const [errorKey, setErrorKey] = useState<RankActionErrorKey | null>(null);
  const [, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const result = await listRankConfigsAction();
      if (result.ok) {
        setRanks(result.ranks);
      }
    });
  }

  if (ranks.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("listEmpty")}</p>;
  }

  return (
    <>
      {errorKey && (
        <p role="alert" className="mb-3 text-sm font-medium text-destructive">
          {t(errorKey)}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/40">
              <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colRankName")}</th>
              <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colMrvRequired")}</th>
              <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colReferralsRequired")}</th>
              <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colRewardAmount")}</th>
              <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colStatus")}</th>
              <th className="px-3 py-2 text-end font-medium text-muted-foreground">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {ranks.map((rank) => (
              <tr key={rank.id} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{rank.rankName}</div>
                  {rank.achievedByAnyUser && (
                    <div className="mt-0.5 flex flex-row items-center gap-1.5 text-xs text-muted-foreground">
                      <Lock className="size-3 shrink-0" aria-hidden="true" />
                      <span>{t("editLockedNotice")}</span>
                    </div>
                  )}
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
                <td className="px-3 py-2">
                  <Badge variant="success">{t("statusActive")}</Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-row justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer"
                      disabled={rank.achievedByAnyUser}
                      onClick={() => setEditTarget(rank)}
                    >
                      {t("edit")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editTarget && (
        <EditRankDialog
          rank={editTarget}
          locale={locale}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            setErrorKey(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
