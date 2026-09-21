"use client";

import { useTranslations } from "next-intl";
import { Gift } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, toDisplayWithCurrency } from "@/lib/display";

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
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
          <Gift className="size-6" aria-hidden="true" />
        </div>
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
              <span dir="ltr" className="font-heading text-lg font-semibold tabular-nums text-success">
                +{toDisplayWithCurrency(entry.amount)}
              </span>
              <p className="text-xs text-muted-foreground">{formatDate(new Date(entry.createdAt), locale)}</p>
            </div>
            <Badge variant="outline">
              {entry.wallet === "C" ? t("destinationWalletC") : t("destinationSaving")}
            </Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
