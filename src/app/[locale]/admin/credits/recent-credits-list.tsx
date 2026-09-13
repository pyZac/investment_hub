"use client";

import { useTranslations, useFormatter } from "next-intl";

type RecentCreditRow = {
  id: string;
  targetUserName: string | null;
  targetUserEmail: string | null;
  adminName: string;
  amount: string;
  reason: string | null;
  createdAt: string;
};

export function RecentCreditsList({ initialCredits }: { initialCredits: RecentCreditRow[] }) {
  const t = useTranslations("AdminCredits");
  const format = useFormatter();

  if (initialCredits.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("recentEmpty")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/40">
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colUser")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colAmount")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colIssuedBy")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colReason")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colDate")}</th>
          </tr>
        </thead>
        <tbody>
          {initialCredits.map((c) => (
            <tr key={c.id} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-2">
                <div className="font-medium">{c.targetUserName ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{c.targetUserEmail ?? ""}</div>
              </td>
              <td className="px-3 py-2 font-heading font-semibold tabular-nums" dir="ltr">
                {c.amount}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{c.adminName}</td>
              <td className="px-3 py-2 text-muted-foreground">{c.reason ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                {format.dateTime(new Date(c.createdAt), { dateStyle: "medium", timeStyle: "short" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
