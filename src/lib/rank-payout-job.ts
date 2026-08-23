import { prisma } from "./prisma";
import * as rank from "./rank";
import { saturdayWeekStart } from "./binary-cycle";

export const RANK_PAYOUT_JOB_TYPE = "rank_payout";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

function periodKeyFor(weekStart: Date): string {
  return weekStart.toISOString();
}

function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getTime() + weeks * MS_PER_WEEK);
}

/**
 * The most recently CLOSEABLE cycle's week_start relative to `today`, same
 * definition as binary-cycle-job.ts's own `mostRecentCloseableWeekStart` —
 * a week isn't closeable (its Friday processing cycle complete) until its
 * own Friday 23:59 has passed, so this is `saturdayWeekStart(today) - 7
 * days`. Reuses the SAME weekly cadence as the binary commission payout
 * (both settle on the Saturday-to-Friday cycle boundary).
 */
function mostRecentCloseableWeekStart(today: Date): Date {
  return new Date(saturdayWeekStart(today).getTime() - MS_PER_WEEK);
}

/**
 * Every unprocessed rank-payout week from the last COMPLETED period
 * (exclusive) through the most recently closeable week relative to `today`
 * (inclusive), oldest first. Mirrors binary-cycle-job.ts's
 * `unprocessedWeeks` exactly.
 *
 * If no job_runs row exists yet at all, there is nothing to "catch up" on —
 * per the standing SCRUM-52 lesson, a job that has never run before was
 * never "missed" for any earlier week; the only unprocessed period on a
 * true first run is the single most recently closeable week, never a walk
 * back to an arbitrary epoch.
 */
async function unprocessedWeeks(today: Date): Promise<Date[]> {
  const lastCompleted = await prisma.jobRun.findFirst({
    where: { jobType: RANK_PAYOUT_JOB_TYPE, status: "COMPLETED" },
    orderBy: { periodKey: "desc" },
  });

  const end = mostRecentCloseableWeekStart(today);
  const start = lastCompleted ? addWeeks(new Date(lastCompleted.periodKey), 1) : end;

  const weeks: Date[] = [];
  for (let cursor = start; cursor <= end; cursor = addWeeks(cursor, 1)) {
    weeks.push(cursor);
  }
  return weeks;
}

/**
 * Runs the weekly rank-reward payout sweep for every unprocessed week up
 * to and including the most recently closeable one, in chronological
 * order. Each week simply invokes `payQueuedRankRewards` once — unlike the
 * binary cycle job, there is no per-user unit here (the sweep itself has
 * no per-user scope, per its own design: it pays every currently-queued
 * award in one pass, regardless of which week originally granted it).
 *
 * Takes `today` as a parameter and never calls `new Date()` internally
 * (invariant #4) — the worker passes the real current date, tests pass
 * fabricated ones. `forDate` passed into `payQueuedRankRewards` for each
 * week is that week's own `weekStart` — the moment this catch-up run
 * considers that period's payouts to have happened, mirroring how
 * `runOneWeek` in binary-cycle-job.ts stamps its own period's boundary
 * rather than "now" for every period in a multi-week catch-up.
 *
 * Each week is recorded in `job_runs` (RUNNING -> COMPLETED/FAILED) keyed
 * by (job_type, period_key = week_start ISO string) — the SAME weekly
 * cadence key shape as binary_cycle, though a genuinely separate job_type
 * (rank payouts and binary payouts are independent processes that happen
 * to share a cycle boundary). A week already COMPLETED is never
 * reprocessed, and a week that fails partway through stays FAILED so the
 * next call retries it before touching any later week.
 */
export async function runRankPayoutCatchUp(today: Date): Promise<void> {
  const weeks = await unprocessedWeeks(today);

  for (const weekStart of weeks) {
    await runOneWeek(weekStart);
  }
}

async function runOneWeek(weekStart: Date): Promise<void> {
  const periodKey = periodKeyFor(weekStart);
  const existing = await prisma.jobRun.findUnique({
    where: { jobType_periodKey: { jobType: RANK_PAYOUT_JOB_TYPE, periodKey } },
  });
  if (existing?.status === "COMPLETED") {
    return;
  }

  const startedAt = new Date();
  await prisma.jobRun.upsert({
    where: { jobType_periodKey: { jobType: RANK_PAYOUT_JOB_TYPE, periodKey } },
    create: {
      jobType: RANK_PAYOUT_JOB_TYPE,
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
    await rank.payQueuedRankRewards(weekStart);

    await prisma.jobRun.update({
      where: { jobType_periodKey: { jobType: RANK_PAYOUT_JOB_TYPE, periodKey } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.jobRun.update({
      where: { jobType_periodKey: { jobType: RANK_PAYOUT_JOB_TYPE, periodKey } },
      data: { status: "FAILED", completedAt: null, error: message },
    });
    throw error;
  }
}
