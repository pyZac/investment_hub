"use client";

import { useState, useTransition } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listJobStatusesAction, triggerJobRunAction, type JobStatusRow, type JobMonitorErrorKey } from "./actions";

const JOB_TYPE_LABEL_KEYS: Record<string, string> = {
  daily_interest: "jobDailyInterest",
  binary_cycle: "jobBinaryCycle",
  rank_evaluation: "jobRankEvaluation",
  rank_payout: "jobRankPayout",
};

function statusBadgeVariant(status: JobStatusRow["currentStatus"]): "success" | "destructive" | "warning" | "secondary" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "destructive";
  if (status === "RUNNING") return "warning";
  return "secondary";
}

export function JobStatusList({ initialJobs, locale }: { initialJobs: JobStatusRow[]; locale: string }) {
  const t = useTranslations("AdminJobMonitor");
  const format = useFormatter();
  const [jobs, setJobs] = useState(initialJobs);
  const [triggeringJobType, setTriggeringJobType] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<JobMonitorErrorKey | null>(null);
  const [, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const result = await listJobStatusesAction();
      if (result.ok) {
        setJobs(result.jobs);
      }
    });
  }

  function handleTrigger(jobType: string) {
    setErrorKey(null);
    setTriggeringJobType(jobType);
    startTransition(async () => {
      const result = await triggerJobRunAction(jobType, locale);
      setTriggeringJobType(null);
      if (result.ok) {
        refresh();
      } else {
        setErrorKey(result.errorKey);
      }
    });
  }

  return (
    <>
      {errorKey && (
        <p role="alert" className="mb-3 text-sm font-medium text-destructive">
          {t(errorKey)}
        </p>
      )}
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
                  <div className="flex flex-row justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer"
                      disabled={triggeringJobType === job.jobType}
                      onClick={() => handleTrigger(job.jobType)}
                    >
                      {triggeringJobType === job.jobType ? t("triggering") : t("triggerNow")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
