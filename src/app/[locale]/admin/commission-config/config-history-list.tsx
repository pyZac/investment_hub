"use client";

import { useTranslations, useFormatter } from "next-intl";
import { Badge } from "@/components/ui/badge";

type ConfigHistoryRow = {
  id: string;
  directRate: string;
  directCommissionSplit: string;
  directSavingSplit: string;
  binaryRate: string;
  binaryCarryForwardExpiryMonths: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  setByAdminName: string | null;
  createdAt: string;
};

export function ConfigHistoryList({ initialHistory }: { initialHistory: ConfigHistoryRow[] }) {
  const t = useTranslations("AdminCommissionConfig");
  const format = useFormatter();

  if (initialHistory.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/40">
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colDirectRate")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colDirectSplit")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colBinaryRate")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colCarryForward")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colEffectiveFrom")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colEffectiveTo")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colSetBy")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colCreatedAt")}</th>
          </tr>
        </thead>
        <tbody>
          {initialHistory.map((r) => (
            <tr key={r.id} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-2 font-heading font-semibold tabular-nums" dir="ltr">
                {r.directRate}%
              </td>
              <td className="px-3 py-2 tabular-nums" dir="ltr">
                {r.directCommissionSplit}% / {r.directSavingSplit}%
              </td>
              <td className="px-3 py-2 font-heading font-semibold tabular-nums" dir="ltr">
                {r.binaryRate}%
              </td>
              <td className="px-3 py-2 tabular-nums" dir="ltr">
                {r.binaryCarryForwardExpiryMonths}
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
