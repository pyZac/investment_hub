"use client";

import type { LedgerEntryType, Wallet } from "@prisma/client";
import { useTranslations, useLocale } from "next-intl";
import { Receipt } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, toDisplayWithCurrency } from "@/lib/display";
import { ENTRY_TYPE_LABELS } from "@/lib/transaction-history";

type TransactionRow = {
  id: string;
  wallet: Wallet;
  direction: "CREDIT" | "DEBIT";
  amount: string;
  entryType: LedgerEntryType;
  description: string;
  createdAt: string;
};

function walletLabel(wallet: Wallet): string {
  return wallet === "SAVING" ? "SAVING" : `Wallet ${wallet}`;
}

export function TransactionList({ entries }: { entries: TransactionRow[] }) {
  const t = useTranslations("Transactions");
  const locale = useLocale();

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
          <Receipt className="size-6" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("emptyStateTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("emptyStateDescription")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <Card key={entry.id} className="border-border/60 shadow-sm">
          <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 space-y-1">
              <div className="flex flex-row flex-wrap items-center gap-2">
                <span className="font-heading text-sm font-medium">{ENTRY_TYPE_LABELS[entry.entryType]}</span>
                <Badge variant="outline">{walletLabel(entry.wallet)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{formatDate(new Date(entry.createdAt), locale)}</p>
              <p className="text-sm text-muted-foreground">{entry.description}</p>
            </div>
            <span
              dir="ltr"
              className={`font-heading text-lg font-semibold tabular-nums ${
                entry.direction === "CREDIT" ? "text-success" : "text-foreground"
              }`}
            >
              {entry.direction === "CREDIT" ? "+" : "−"}
              {toDisplayWithCurrency(entry.amount)}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
