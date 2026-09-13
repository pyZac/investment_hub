"use client";

import { useTranslations, useFormatter } from "next-intl";
import { Badge } from "@/components/ui/badge";

type DecidedRow = {
  id: string;
  userName: string;
  userEmail: string;
  amount: string;
  status: "APPROVED" | "REJECTED";
  requestedAt: string;
  decidedAt: string | null;
  decidedByAdminName: string | null;
  adminComment: string | null;
};

export function DecisionHistory({ initialRequests }: { initialRequests: DecidedRow[] }) {
  const t = useTranslations("AdminWithdrawals");
  const format = useFormatter();

  if (initialRequests.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/40">
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colUser")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colAmount")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colStatus")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colDecidedBy")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colDecidedAt")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colReason")}</th>
          </tr>
        </thead>
        <tbody>
          {initialRequests.map((r) => (
            <tr key={r.id} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-2">
                <div className="font-medium">{r.userName}</div>
                <div className="text-xs text-muted-foreground">{r.userEmail}</div>
              </td>
              <td className="px-3 py-2 font-heading font-semibold tabular-nums" dir="ltr">
                {r.amount}
              </td>
              <td className="px-3 py-2">
                <Badge variant={r.status === "APPROVED" ? "success" : "destructive"}>
                  {r.status === "APPROVED" ? t("statusApproved") : t("statusRejected")}
                </Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{r.decidedByAdminName ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                {r.decidedAt
                  ? format.dateTime(new Date(r.decidedAt), { dateStyle: "medium", timeStyle: "short" })
                  : "—"}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{r.adminComment ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
