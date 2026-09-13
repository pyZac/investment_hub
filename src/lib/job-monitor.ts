import { prisma } from "./prisma";
import { runDailyInterestCatchUp, DAILY_INTEREST_JOB_TYPE } from "./daily-interest-job";
import { runBinaryCycleCatchUp, BINARY_CYCLE_JOB_TYPE } from "./binary-cycle-job";
import { runRankEvaluationCatchUp, RANK_EVALUATION_JOB_TYPE } from "./rank-evaluation-job";
import { runRankPayoutCatchUp, RANK_PAYOUT_JOB_TYPE } from "./rank-payout-job";

async function assertHasJobMonitorPermission(actingAdminId: string): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }
  if (admin.isMainAdmin) {
    return;
  }
  const grant = await prisma.adminPermissionGrant.findUnique({
    where: { adminUserId_permission: { adminUserId: actingAdminId, permission: "JOB_MONITOR" } },
  });
  if (!grant) {
    throw new Error("Forbidden: missing JOB_MONITOR permission.");
  }
}

/**
 * The 4 real scheduled jobs (src/worker/index.ts) — the single source of
 * truth this screen mirrors. SCRUM-112's own ticket text named a
 * "carry_forward_expiry" job that does not exist as a separate cron
 * entry/catch-up function (carry-forward expiry is logic applied INSIDE
 * runBinaryCycleCatchUp's own closeBinaryCycleForUser call, not an
 * independent job), and omitted rank_evaluation, which does exist — this
 * list is deliberately the real 4, confirmed with the project owner,
 * per this ticket's own "No new cron logic" constraint.
 *
 * Each catch-up function is safe to call again by construction: every one
 * of them only ever processes periods whose job_runs row is not already
 * COMPLETED (a period that already succeeded is a pure no-op on replay).
 * This IS the ticket's "manual re-trigger must use the existing job
 * functions... cannot double-post" requirement — no separate safety
 * mechanism is layered on top here, the same guarantee the real scheduler
 * itself already relies on to survive a missed cron tick.
 */
export const JOB_TYPES = [
  { jobType: DAILY_INTEREST_JOB_TYPE, run: runDailyInterestCatchUp },
  { jobType: BINARY_CYCLE_JOB_TYPE, run: runBinaryCycleCatchUp },
  { jobType: RANK_EVALUATION_JOB_TYPE, run: runRankEvaluationCatchUp },
  { jobType: RANK_PAYOUT_JOB_TYPE, run: runRankPayoutCatchUp },
] as const;

export type JobType = (typeof JOB_TYPES)[number]["jobType"];

export type JobStatus = {
  jobType: JobType;
  /** The most recent row overall by periodKey, whatever its status — this
   * IS "current status" (a job whose latest period is still RUNNING or
   * FAILED is not healthy, even if an earlier period succeeded). */
  currentStatus: "RUNNING" | "COMPLETED" | "FAILED" | "NEVER_RUN";
  lastCompletedPeriodKey: string | null;
  lastCompletedAt: Date | null;
  lastFailedPeriodKey: string | null;
  lastFailedAt: Date | null;
  lastFailedError: string | null;
};

/**
 * One row per real job type, for the admin panel's job-status list.
 * JOB_MONITOR-gated (main admin bypass). Reads `job_runs` only — never
 * touches the scheduler itself (this screen monitors and triggers
 * existing jobs, it does not replace or duplicate the cron logic in
 * src/worker/index.ts).
 *
 * `periodKey` is an opaque per-job string (a calendar day for
 * daily_interest, a week-start for binary_cycle/rank_payout, a month for
 * rank_evaluation) — ordering by periodKey descending still correctly
 * finds "most recent" within a single job type, since each job's own
 * period-key format sorts chronologically as a string (ISO dates and
 * YYYY-MM month keys both do).
 */
export async function listJobStatuses(actingAdminId: string): Promise<JobStatus[]> {
  await assertHasJobMonitorPermission(actingAdminId);

  const statuses: JobStatus[] = [];
  for (const { jobType } of JOB_TYPES) {
    const [latest, lastCompleted, lastFailed] = await Promise.all([
      prisma.jobRun.findFirst({ where: { jobType }, orderBy: { periodKey: "desc" } }),
      prisma.jobRun.findFirst({ where: { jobType, status: "COMPLETED" }, orderBy: { periodKey: "desc" } }),
      prisma.jobRun.findFirst({ where: { jobType, status: "FAILED" }, orderBy: { periodKey: "desc" } }),
    ]);

    statuses.push({
      jobType,
      currentStatus: latest?.status ?? "NEVER_RUN",
      lastCompletedPeriodKey: lastCompleted?.periodKey ?? null,
      lastCompletedAt: lastCompleted?.completedAt ?? null,
      lastFailedPeriodKey: lastFailed?.periodKey ?? null,
      lastFailedAt: lastFailed?.startedAt ?? null,
      lastFailedError: lastFailed?.error ?? null,
    });
  }

  return statuses;
}

export class UnknownJobTypeError extends Error {
  constructor(jobType: string) {
    super(`Unknown job type "${jobType}".`);
    this.name = "UnknownJobTypeError";
  }
}

/**
 * Manually re-triggers one job's catch-up function — the SAME function
 * the real scheduler calls, with the SAME `forDate` semantics (invariant
 * #4: caller-supplied, never `new Date()` internally in this function
 * itself; the caller — the admin action layer — passes the real "now").
 * Safe to call even if the scheduled run already fired today: catch-up
 * only ever processes not-yet-COMPLETED periods, so re-running after a
 * successful scheduled run is a pure no-op, never a double-post.
 *
 * Logs `JOB_MONITOR_TRIGGERED` to admin_actions so a manual trigger is
 * attributable to the acting admin — the scheduler's own runs have no
 * such row (they're not admin-initiated), which is exactly the
 * distinction this log is for.
 */
export async function triggerJobRun(actingAdminId: string, jobType: string, forDate: Date): Promise<void> {
  await assertHasJobMonitorPermission(actingAdminId);

  const entry = JOB_TYPES.find((j) => j.jobType === jobType);
  if (!entry) {
    throw new UnknownJobTypeError(jobType);
  }

  await entry.run(forDate);

  await prisma.adminAction.create({
    data: {
      adminId: actingAdminId,
      actionType: "JOB_MONITOR_TRIGGERED",
      reason: `Manually triggered job "${jobType}".`,
    },
  });
}
