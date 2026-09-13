"use client";

import { useEffect, useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { getSubAdminActionHistoryAction } from "./actions";

type HistoryRow = { id: string; actionType: string; reason: string | null; createdAt: string };

export function SubAdminActionLog({ subAdminId }: { subAdminId: string }) {
  const t = useTranslations("AdminSubAdmins");
  const format = useFormatter();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSubAdminActionHistoryAction(subAdminId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setRows(result.actions);
      } else {
        setError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [subAdminId]);

  if (error) {
    return <p className="mt-2 text-sm text-destructive">{t("errorGeneric")}</p>;
  }

  if (rows === null) {
    return <p className="mt-2 text-sm text-muted-foreground">{t("saving")}</p>;
  }

  if (rows.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">{t("historyEmpty")}</p>;
  }

  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/40 text-start">
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("historyDateLabel")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("historyActionLabel")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("historyReasonLabel")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                {format.dateTime(new Date(row.createdAt), { dateStyle: "medium", timeStyle: "short" })}
              </td>
              <td className="px-3 py-2 font-medium" dir="ltr">
                {t(`actionType_${row.actionType}` as never)}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{row.reason ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
