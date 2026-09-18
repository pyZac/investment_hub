"use client";

import { useTranslations, useFormatter } from "next-intl";

type RecentAdjustmentRow = {
  id: string;
  adminName: string;
  reason: string | null;
  createdAt: string;
};

export function RecentAdjustmentsList({ initialAdjustments }: { initialAdjustments: RecentAdjustmentRow[] }) {
  const t = useTranslations("AdminManualAdjustment");
  const format = useFormatter();

  if (initialAdjustments.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/40">
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colReversedBy")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colReason")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colCreatedAt")}</th>
          </tr>
        </thead>
        <tbody>
          {initialAdjustments.map((a) => (
            <tr key={a.id} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-2 font-medium">{a.adminName}</td>
              <td className="px-3 py-2 text-muted-foreground">{a.reason}</td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                {format.dateTime(new Date(a.createdAt), { dateStyle: "medium", timeStyle: "short" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
