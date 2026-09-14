import { prisma } from "./prisma";
import { runReconciliation } from "./reconciliation";
import { runInvariantChecks } from "./invariant-checks";

export const RECONCILIATION_JOB_TYPE = "reconciliation";

function periodKeyFor(forDate: Date): string {
  return forDate.toISOString().slice(0, 10);
}

/**
 * Nightly reconciliation + invariant sweep, wrapped in the same `job_runs`
 * pattern every other scheduled job in this project uses (daily_interest,
 * binary_cycle, rank_evaluation, rank_payout) so it appears on the existing
 * job-monitor admin screen and can be manually re-triggered from there via
 * `job-monitor.ts`'s `JOB_TYPES` array, with no new admin UI needed.
 *
 * Unlike the other jobs, this one has no real backlog to "catch up" —
 * `runReconciliation`/`runInvariantChecks` are point-in-time snapshot checks
 * of current state, not something with per-period business data to
 * (re)process. It still takes `forDate` (invariant #4) and keys its
 * `job_runs` row by calendar day exactly like `daily_interest`, so a
 * COMPLETED run for today is a genuine record ("the DB was sound as of this
 * check") and a re-trigger for an already-COMPLETED day is a safe no-op —
 * matching every other job's idempotent-re-trigger contract in
 * job-monitor.ts, rather than silently re-running the check underneath an
 * admin who expects "re-trigger" to mean "replay," not "check again right
 * now."
 *
 * On failure, the job_runs row's `error` field carries the same detailed
 * message `runReconciliation`/`runInvariantChecks` throw (user/wallet/drift
 * amounts, or the specific invariant violated) — visible to the admin on
 * the job-monitor screen with the same clarity as any other job failure,
 * per the phase-12 framing that drift is a potential tampering signal, not
 * merely a bug signal.
 */
export async function runReconciliationCatchUp(forDate: Date): Promise<void> {
  const periodKey = periodKeyFor(forDate);

  const existing = await prisma.jobRun.findUnique({
    where: { jobType_periodKey: { jobType: RECONCILIATION_JOB_TYPE, periodKey } },
  });
  if (existing?.status === "COMPLETED") {
    return;
  }

  const startedAt = new Date();
  await prisma.jobRun.upsert({
    where: { jobType_periodKey: { jobType: RECONCILIATION_JOB_TYPE, periodKey } },
    create: {
      jobType: RECONCILIATION_JOB_TYPE,
      periodKey,
      status: "RUNNING",
      startedAt,
    },
    update: {
      status: "RUNNING",
      startedAt,
      completedAt: null,
      error: null,
    },
  });

  try {
    await runReconciliation();
    await runInvariantChecks({ throwOnViolation: true });

    await prisma.jobRun.update({
      where: { jobType_periodKey: { jobType: RECONCILIATION_JOB_TYPE, periodKey } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.jobRun.update({
      where: { jobType_periodKey: { jobType: RECONCILIATION_JOB_TYPE, periodKey } },
      data: { status: "FAILED", completedAt: null, error: message },
    });
    throw error;
  }
}
