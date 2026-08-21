"use client";

import { useTranslations } from "next-intl";
import { Gift } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/display";

type CommissionEntry = {
  id: string;
  wallet: "C" | "SAVING";
  amount: string;
  createdAt: string;
};

export function CommissionHistoryList({ entries, locale }: { entries: CommissionEntry[]; locale: string }) {
  const t = useTranslations("Referrals");

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
        <Gift className="size-10 text-muted-foreground/60" aria-hidden="true" />
        <p className="max-w-sm text-sm text-muted-foreground">{t("commissionHistoryEmptyState")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <Card key={entry.id} className="border-border/60 shadow-sm">
          <CardContent className="flex flex-row items-center justify-between gap-2 py-4">
            <div className="space-y-1">
              <span className="text-lg font-semibold tabular-nums">{entry.amount}</span>
              <p className="text-xs text-muted-foreground">{formatDate(new Date(entry.createdAt), locale)}</p>
            </div>
            <Badge variant={entry.wallet === "C" ? "default" : "secondary"}>
              {entry.wallet === "C" ? t("destinationWalletC") : t("destinationSaving")}
            </Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
