"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ENTRY_TYPE_LABELS } from "@/lib/transaction-history";

const WALLETS = ["A", "B", "C", "SAVING"] as const;
const ENTRY_TYPES = Object.keys(ENTRY_TYPE_LABELS) as Array<keyof typeof ENTRY_TYPE_LABELS>;
const ALL = "__all__";

function walletLabel(value: string): string {
  return value === "SAVING" ? "SAVING" : `Wallet ${value}`;
}

export function TransactionFilters({
  wallet,
  entryType,
  dateFrom,
  dateTo,
}: {
  wallet?: string;
  entryType?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const t = useTranslations("Transactions");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function applyParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null || value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    next.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  }

  const hasAnyFilter = Boolean(wallet || entryType || dateFrom || dateTo);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="space-y-1.5">
        <Label>{t("filterWalletLabel")}</Label>
        <Select
          value={wallet ?? ALL}
          onValueChange={(value) => applyParam("wallet", value === ALL ? null : String(value))}
        >
          <SelectTrigger className="w-40">
            <SelectValue>
              {(value: string) => (value === ALL ? t("filterWalletAll") : walletLabel(value))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("filterWalletAll")}</SelectItem>
            {WALLETS.map((w) => (
              <SelectItem key={w} value={w}>
                {walletLabel(w)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>{t("filterTypeLabel")}</Label>
        <Select
          value={entryType ?? ALL}
          onValueChange={(value) => applyParam("type", value === ALL ? null : String(value))}
        >
          <SelectTrigger className="w-52">
            <SelectValue>
              {(value: string) =>
                value === ALL ? t("filterTypeAll") : ENTRY_TYPE_LABELS[value as keyof typeof ENTRY_TYPE_LABELS]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("filterTypeAll")}</SelectItem>
            {ENTRY_TYPES.map((key) => (
              <SelectItem key={key} value={key}>
                {ENTRY_TYPE_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tx-date-from">{t("filterDateFromLabel")}</Label>
        <Input
          id="tx-date-from"
          type="date"
          className="w-40"
          defaultValue={dateFrom ?? ""}
          onChange={(e) => applyParam("from", e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tx-date-to">{t("filterDateToLabel")}</Label>
        <Input
          id="tx-date-to"
          type="date"
          className="w-40"
          defaultValue={dateTo ?? ""}
          onChange={(e) => applyParam("to", e.target.value)}
        />
      </div>

      {hasAnyFilter && (
        <Button
          variant="ghost"
          className="cursor-pointer"
          onClick={() => {
            startTransition(() => {
              router.push(pathname);
            });
          }}
        >
          <span className="flex flex-row items-center gap-2">
            <X className="size-4 shrink-0" aria-hidden="true" />
            <span>{t("filterClear")}</span>
          </span>
        </Button>
      )}
    </div>
  );
}
