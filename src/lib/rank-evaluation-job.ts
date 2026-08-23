import { prisma } from "./prisma";
import * as rank from "./rank";

export const RANK_EVALUATION_JOB_TYPE = "rank_evaluation";

function addMonths(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * The most recently CLOSEABLE month relative to `today`: a calendar month
 * isn't closeable (its MRV totals final) until it has fully ended — so this
 * is the month immediately before `today`'s own current month.
 */
function mostRecentCloseableMonth(today: Date): string {
  return addMonths(rank.dubaiMonthKey(today), -1);
}

/**
 * Every unprocessed rank-evaluation month from the last COMPLETED period
 * (exclusive) through the most recently closeable month relative to `today`
 * (inclusive), oldest first. Mirrors binary-cycle-job.ts's
 * `unprocessedWeeks` exactly, stepping by months instead of weeks.
 *
 * If no job_runs row exists yet at all, there is nothing to "catch up" on —
 * per the standing SCRUM-52 lesson, a job that has never run before was
 * never "missed" for any earlier month; the only unprocessed period on a
 * true first run is the single most recently closeable month, never a walk
 * back to an arbitrary epoch.
 */
async function unprocessedMonths(today: Date): Promise<string[]> {
  const lastCompleted = await prisma.jobRun.findFirst({
    where: { jobType: RANK_EVALUATION_JOB_TYPE, status: "COMPLETED" },
    orderBy: { periodKey: "desc" },
  });

  const end = mostRecentCloseableMonth(today);
  const start = lastCompleted ? addMonths(lastCompleted.periodKey, 1) : end;

  const months: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addMonths(cursor, 1)) {
    months.push(cursor);
  }
  return months;
}

/**
 * Runs the monthly rank evaluation for every unprocessed month up to and
 * including the most recently closeable one, in chronological order, for
 * every user with at least one `mrv_periods` row for that specific month —
 * a user with zero MRV activity that month can never meet even the lowest
 * rank's threshold (Investor: 25,000) regardless of referral count, so
 * scoping to users with real MRV activity avoids a full-table scan every
 * month for users who could never qualify anyway (mirrors SCRUM-80's
 * precedent of skipping never-placed users in the binary cycle job).
 *
 * Takes `today` as a parameter and never calls `new Date()` internally
 * (invariant #4) — the worker passes the real current date, tests pass
 * fabricated ones.
 *
 * Each month is recorded in `job_runs` (RUNNING -> COMPLETED/FAILED) keyed
 * by (job_type, period_key = "YYYY-MM"), so a month already COMPLETED is
 * never reprocessed, and a month that fails partway through stays FAILED
 * (not COMPLETED) so the next call retries it before touching any later
 * month — catch-up always proceeds strictly in order, mirroring
 * runBinaryCycleCatchUp exactly.
 */
export async function runRankEvaluationCatchUp(today: Date): Promise<void> {
  const months = await unprocessedMonths(today);

  for (const month of months) {
    await runOneMonth(month, today);
  }
}

async function runOneMonth(month: string, forDate: Date): Promise<void> {
  const existing = await prisma.jobRun.findUnique({
    where: { jobType_periodKey: { jobType: RANK_EVALUATION_JOB_TYPE, periodKey: month } },
  });
  if (existing?.status === "COMPLETED") {
    return;
  }

  const startedAt = new Date();
  await prisma.jobRun.upsert({
    where: { jobType_periodKey: { jobType: RANK_EVALUATION_JOB_TYPE, periodKey: month } },
    create: {
      jobType: RANK_EVALUATION_JOB_TYPE,
      periodKey: month,
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
    const periods = await prisma.mrvPeriod.findMany({
      where: { month },
      select: { userId: true },
    });

    for (const period of periods) {
      await rank.evaluateRankForUser(period.userId, month, forDate);
    }

    await prisma.jobRun.update({
      where: { jobType_periodKey: { jobType: RANK_EVALUATION_JOB_TYPE, periodKey: month } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.jobRun.update({
      where: { jobType_periodKey: { jobType: RANK_EVALUATION_JOB_TYPE, periodKey: month } },
      data: { status: "FAILED", completedAt: null, error: message },
    });
    throw error;
  }
}
