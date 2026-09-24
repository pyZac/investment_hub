"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations, useFormatter } from "next-intl";
import { Badge } from "@/components/ui/badge";

export type JobStatusRow = {
  jobType: string;
  currentStatus: "RUNNING" | "COMPLETED" | "FAILED" | "NEVER_RUN";
  lastCompletedPeriodKey: string | null;
  lastCompletedAt: string | null;
  lastFailedPeriodKey: string | null;
  lastFailedAt: string | null;
  lastFailedError: string | null;
};

export const JOB_TYPE_LABEL_KEYS: Record<string, string> = {
  daily_interest: "jobDailyInterest",
  binary_cycle: "jobBinaryCycle",
  rank_evaluation: "jobRankEvaluation",
  rank_payout: "jobRankPayout",
  reconciliation: "jobReconciliation",
};

export function statusBadgeVariant(
  status: JobStatusRow["currentStatus"],
): "success" | "destructive" | "warning" | "secondary" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "destructive";
  if (status === "RUNNING") return "warning";
  return "secondary";
}

/**
 * Shared job-status table body used by both /admin/job-monitor and
 * /admin/developer-tools — the columns and cell rendering are identical on
 * both screens; only what appears in the trailing action column differs
 * (each caller passes its own `renderAction`), so this isn't duplicated
 * between the two pages.
 */
export function JobStatusTable({
  jobs,
  namespace,
  renderAction,
}: {
  jobs: JobStatusRow[];
  /** Translation namespace both screens' shared status/column strings live
   * under — "AdminJobMonitor", reused by the Developer Tools page too
   * rather than duplicating the same strings into a second namespace. */
  namespace: string;
  renderAction: (job: JobStatusRow) => React.ReactNode;
}) {
  const t = useTranslations(namespace);
  const format = useFormatter();

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/40">
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colJob")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colStatus")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colLastSuccess")}</th>
            <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t("colLastFailure")}</th>
            <th className="px-3 py-2 text-end font-medium text-muted-foreground">{t("colActions")}</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.jobType} className="border-b border-border/40 last:border-0 align-top">
              <td className="px-3 py-2 font-medium" dir="ltr">
                {t(JOB_TYPE_LABEL_KEYS[job.jobType] ?? job.jobType)}
              </td>
              <td className="px-3 py-2">
                <Badge variant={statusBadgeVariant(job.currentStatus)}>{t(`status_${job.currentStatus}`)}</Badge>
              </td>
              <td className="px-3 py-2">
                {job.lastCompletedAt ? (
                  <div className="flex flex-col gap-0.5">
                    <span className="tabular-nums text-muted-foreground whitespace-nowrap">
                      {format.dateTime(new Date(job.lastCompletedAt), { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                      {job.lastCompletedPeriodKey}
                    </span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">{t("neverSucceeded")}</span>
                )}
              </td>
              <td className="px-3 py-2">
                {job.lastFailedAt ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-row items-center gap-1.5 text-destructive">
                      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="tabular-nums whitespace-nowrap">
                        {format.dateTime(new Date(job.lastFailedAt), { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                    </div>
                    {job.lastFailedError && (
                      <span className="max-w-xs text-xs text-muted-foreground break-words">
                        {job.lastFailedError}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">{t("noFailures")}</span>
                )}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-row justify-end">{renderAction(job)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
