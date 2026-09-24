"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { JobStatusTable, JOB_TYPE_LABEL_KEYS, type JobStatusRow } from "@/components/admin/job-status-table";
import { listJobStatusesAction, triggerJobRunAction, type DeveloperToolsErrorKey } from "./actions";

/**
 * Same trigger-with-confirmation flow as job-monitor's own JobStatusList,
 * reachable from a second screen for production-health testing — see this
 * ticket's own "Developer Tools" scope. Deliberately its own component (not
 * job-monitor's JobStatusList imported directly) because it calls a
 * different actions.ts file (DEVELOPER_TOOLS-gated, not JOB_MONITOR), even
 * though the underlying lib functions and job list are identical.
 */
export function JobTriggerList({ initialJobs, locale }: { initialJobs: JobStatusRow[]; locale: string }) {
  const t = useTranslations("AdminJobMonitor");
  const [jobs, setJobs] = useState(initialJobs);
  const [confirmJobType, setConfirmJobType] = useState<string | null>(null);
  const [triggeringJobType, setTriggeringJobType] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<DeveloperToolsErrorKey | null>(null);
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
      setConfirmJobType(null);
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
      <JobStatusTable
        jobs={jobs}
        namespace="AdminJobMonitor"
        renderAction={(job) => (
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            disabled={triggeringJobType === job.jobType}
            onClick={() => setConfirmJobType(job.jobType)}
          >
            {triggeringJobType === job.jobType ? t("triggering") : t("triggerNow")}
          </Button>
        )}
      />

      <Dialog open={confirmJobType !== null} onOpenChange={(open) => !open && setConfirmJobType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmTriggerTitle")}</DialogTitle>
            <DialogDescription>
              {confirmJobType &&
                t("confirmTriggerDescription", { job: t(JOB_TYPE_LABEL_KEYS[confirmJobType] ?? confirmJobType) })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="cursor-pointer"
              disabled={triggeringJobType !== null}
              onClick={() => setConfirmJobType(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              className="cursor-pointer"
              disabled={triggeringJobType !== null}
              onClick={() => confirmJobType && handleTrigger(confirmJobType)}
            >
              {triggeringJobType !== null ? t("triggering") : t("confirmTriggerSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
