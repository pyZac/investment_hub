"use client";

import { useTranslations } from "next-intl";
import { PiggyBank } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/display";

type SavingLotRow = {
  id: string;
  amount: string;
  createdAt: string;
  unlocksAt: string;
  releasedAt: string | null;
};

export function SavingLotsList({ lots, locale }: { lots: SavingLotRow[]; locale: string }) {
  const t = useTranslations("Withdrawals");

  if (lots.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
          <PiggyBank className="size-6" aria-hidden="true" />
        </div>
        <p className="max-w-sm text-sm text-muted-foreground">{t("savingLotsEmptyState")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {lots.map((lot) => {
        const isReleased = lot.releasedAt !== null;
        return (
          <Card key={lot.id} className="border-border/60 shadow-sm">
            <CardContent className="space-y-2 py-4">
              <div className="flex flex-row items-center justify-between gap-2">
                <span className="font-heading text-lg font-semibold tabular-nums" dir="ltr">
                  {lot.amount}
                </span>
                <Badge variant={isReleased ? "success" : "secondary"}>
                  {isReleased ? t("savingLotReleased") : t("savingLotLocked")}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("savingLotStartDate")}: {formatDate(new Date(lot.createdAt), locale)}
              </p>
              <p className="text-xs text-muted-foreground">
                {isReleased ? t("savingLotReleasedOn") : t("savingLotReleaseDate")}:{" "}
                {formatDate(new Date(isReleased ? lot.releasedAt! : lot.unlocksAt), locale)}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
