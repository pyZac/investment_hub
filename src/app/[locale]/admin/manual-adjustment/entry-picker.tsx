"use client";

import { useEffect, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { listUserLedgerEntriesAction, type LedgerEntryRow } from "./actions";
import { toDisplayWithCurrency } from "@/lib/display";

export function EntryPicker({
  userId,
  onSelect,
}: {
  userId: string;
  onSelect: (entry: LedgerEntryRow) => void;
}) {
  const t = useTranslations("AdminManualAdjustment");
  const format = useFormatter();
  const [entries, setEntries] = useState<LedgerEntryRow[] | null>(null);

  useEffect(() => {
    let active = true;
    listUserLedgerEntriesAction(userId).then((result) => {
      if (active && result.ok) {
        setEntries(result.entries);
      }
    });
    return () => {
      active = false;
    };
  }, [userId]);

  if (entries === null) {
    return <p className="text-sm text-muted-foreground">{t("entriesLoading")}</p>;
  }

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("entriesEmpty")}</p>;
  }

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{t("selectEntryLabel")}</p>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelect(entry)}
            className="flex w-full flex-row items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5 text-start text-sm last:border-0 hover:bg-muted cursor-pointer"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{entry.entryTypeLabel}</span>
              <span className="text-xs text-muted-foreground" dir="ltr">
                Wallet {entry.wallet}
              </span>
              {entry.comment && <span className="text-xs text-muted-foreground">{entry.comment}</span>}
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="font-heading font-semibold tabular-nums" dir="ltr">
                {entry.direction === "CREDIT" ? "+" : "−"}
                {toDisplayWithCurrency(entry.amount)}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                {format.dateTime(new Date(entry.createdAt), { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
