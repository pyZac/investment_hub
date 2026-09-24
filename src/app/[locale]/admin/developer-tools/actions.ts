"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/route-guard";
import {
  getFridayBypassStatus,
  setFridayBypass,
  listJobStatuses,
  triggerJobRun,
} from "@/lib/developer-tools";
import { UnknownJobTypeError, type JobType } from "@/lib/job-monitor";

export type DeveloperToolsErrorKey = "errorUnknownJob" | "errorForbidden" | "errorGeneric";

function mapError(err: unknown): DeveloperToolsErrorKey {
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

export type JobStatusListResult = { ok: true; jobs: JobStatusRow[] } | { ok: false; errorKey: DeveloperToolsErrorKey };

export async function listJobStatusesAction(): Promise<JobStatusListResult> {
  try {
    const actor = await requirePermission("DEVELOPER_TOOLS", new Date());
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

export type TriggerJobResult = { ok: true } | { ok: false; errorKey: DeveloperToolsErrorKey };

/**
 * Calls requirePermission("DEVELOPER_TOOLS", ...) first — the real
 * server-side enforcement point (invariant #8) — before job-monitor.ts's
 * own inline JOB_MONITOR re-check runs inside triggerJobRun. Both
 * permissions gate this one action deliberately: a sub-admin needs
 * DEVELOPER_TOOLS to reach this screen at all, and triggerJobRun itself
 * still independently enforces JOB_MONITOR (defense in depth, same as
 * every other lib function that re-checks its own permission regardless
 * of what called it).
 */
export async function triggerJobRunAction(jobType: string, locale: string): Promise<TriggerJobResult> {
  try {
    const actor = await requirePermission("DEVELOPER_TOOLS", new Date());
    await triggerJobRun(actor.id, jobType, new Date());
    revalidatePath(`/${locale}/admin/developer-tools`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type FridayBypassStatusRow = {
  enabled: boolean;
  updatedAt: string;
  updatedByAdminName: string | null;
};

export type FridayBypassStatusResult =
  | { ok: true; status: FridayBypassStatusRow }
  | { ok: false; errorKey: DeveloperToolsErrorKey };

export async function getFridayBypassStatusAction(): Promise<FridayBypassStatusResult> {
  try {
    const actor = await requirePermission("DEVELOPER_TOOLS", new Date());
    const status = await getFridayBypassStatus(actor.id);
    return {
      ok: true,
      status: {
        enabled: status.enabled,
        updatedAt: status.updatedAt.toISOString(),
        updatedByAdminName: status.updatedByAdminName,
      },
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type SetFridayBypassResult = { ok: true } | { ok: false; errorKey: DeveloperToolsErrorKey };

export async function setFridayBypassAction(enabled: boolean, locale: string): Promise<SetFridayBypassResult> {
  try {
    const actor = await requirePermission("DEVELOPER_TOOLS", new Date());
    await setFridayBypass(actor.id, enabled);
    revalidatePath(`/${locale}/admin/developer-tools`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
