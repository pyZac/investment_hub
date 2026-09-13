"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/route-guard";
import { listJobStatuses, triggerJobRun, UnknownJobTypeError, type JobType } from "@/lib/job-monitor";

export type JobMonitorErrorKey = "errorUnknownJob" | "errorForbidden" | "errorGeneric";

function mapError(err: unknown): JobMonitorErrorKey {
  if (err instanceof UnknownJobTypeError) return "errorUnknownJob";
  if (err instanceof Error && /forbidden/i.test(err.message)) return "errorForbidden";
  return "errorGeneric";
}

export type JobStatusRow = {
  jobType: JobType;
  currentStatus: "RUNNING" | "COMPLETED" | "FAILED" | "NEVER_RUN";
  lastCompletedPeriodKey: string | null;
  lastCompletedAt: string | null;
  lastFailedPeriodKey: string | null;
  lastFailedAt: string | null;
  lastFailedError: string | null;
};

export type JobStatusListResult = { ok: true; jobs: JobStatusRow[] } | { ok: false; errorKey: JobMonitorErrorKey };

export async function listJobStatusesAction(): Promise<JobStatusListResult> {
  try {
    const actor = await requirePermission("JOB_MONITOR", new Date());
    const jobs = await listJobStatuses(actor.id);
    return {
      ok: true,
      jobs: jobs.map((j) => ({
        jobType: j.jobType,
        currentStatus: j.currentStatus,
        lastCompletedPeriodKey: j.lastCompletedPeriodKey,
        lastCompletedAt: j.lastCompletedAt?.toISOString() ?? null,
        lastFailedPeriodKey: j.lastFailedPeriodKey,
        lastFailedAt: j.lastFailedAt?.toISOString() ?? null,
        lastFailedError: j.lastFailedError,
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type TriggerJobResult = { ok: true } | { ok: false; errorKey: JobMonitorErrorKey };

/**
 * Calls requirePermission("JOB_MONITOR", ...) first — the real
 * server-side enforcement point (invariant #8), before job-monitor.ts's
 * own inline re-check. Passes real "now" as `forDate` (invariant #4) —
 * this action is the one legitimate call site for `new Date()` on this
 * screen, matching how src/worker/index.ts itself is the only legitimate
 * `new Date()` call site for the scheduled runs.
 */
export async function triggerJobRunAction(jobType: string, locale: string): Promise<TriggerJobResult> {
  try {
    const actor = await requirePermission("JOB_MONITOR", new Date());
    await triggerJobRun(actor.id, jobType, new Date());
    revalidatePath(`/${locale}/admin/job-monitor`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
