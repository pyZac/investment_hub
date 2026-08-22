import { prisma } from "./prisma";
import * as binaryCycle from "./binary-cycle";

export const BINARY_CYCLE_JOB_TYPE = "binary_cycle";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

function periodKeyFor(weekStart: Date): string {
  return weekStart.toISOString();
}

function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getTime() + weeks * MS_PER_WEEK);
}

function weekEndFor(weekStart: Date): Date {
  // Friday 23:59:59.999, i.e. 6 days 23:59:59.999 after weekStart.
  return new Date(weekStart.getTime() + 7 * MS_PER_DAY - 1);
}

/**
 * The most recently CLOSEABLE cycle's week_start relative to `today`: a
 * week isn't closeable until its own Friday 23:59 has passed, so this is
 * `saturdayWeekStart(today) - 7 days` — the week immediately before the
 * one `today` currently falls in. If `today` is itself Saturday 00:00 (the
 * worker's real trigger time), this is exactly the week that just ended.
 */
function mostRecentCloseableWeekStart(today: Date): Date {
  return new Date(binaryCycle.saturdayWeekStart(today).getTime() - MS_PER_WEEK);
}

/**
 * Every unprocessed weekly-cycle-close period from the last COMPLETED
 * period (exclusive) through the most recently closeable week relative to
 * `today` (inclusive), oldest first. Mirrors daily-interest-job.ts's
 * `unprocessedPeriods` exactly, stepping by weeks instead of days.
 *
 * If no job_runs row exists yet at all (the job has never completed a run
 * before), there is nothing to "catch up" on — per the standing SCRUM-52
 * lesson, a job that has never run before was never "missed" for any
 * earlier week; the only unprocessed period on a true first run is the
 * single most recently closeable week, never a walk back to an arbitrary
 * epoch.
 */
async function unprocessedWeeks(today: Date): Promise<Date[]> {
  const lastCompleted = await prisma.jobRun.findFirst({
    where: { jobType: BINARY_CYCLE_JOB_TYPE, status: "COMPLETED" },
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
 * Runs the weekly binary cycle close for every unprocessed week up to and
 * including the most recently closeable one, in chronological order, for
 * every user with a `binary_nodes` row (ever placed in the placement tree
 * — a pure admin or never-placed user can never roll up BV or qualify, so
 * is excluded rather than accumulating a permanent all-zero binary_cycles
 * row every week forever).
 *
 * Takes `today` as a parameter and never calls `new Date()` internally
 * (invariant #4) — the worker passes the real current date, tests pass
 * fabricated ones.
 *
 * Each week is recorded in `job_runs` (RUNNING -> COMPLETED/FAILED) keyed
 * by (job_type, period_key = week_start ISO string), so a week already
 * COMPLETED is never reprocessed, and a week that fails partway through
 * stays FAILED (not COMPLETED) so the next call retries it before
 * touching any later week — catch-up always proceeds strictly in order,
 * mirroring runDailyInterestCatchUp exactly.
 */
export async function runBinaryCycleCatchUp(today: Date): Promise<void> {
  const weeks = await unprocessedWeeks(today);

  for (const weekStart of weeks) {
    await runOneWeek(weekStart);
  }
}

async function runOneWeek(weekStart: Date): Promise<void> {
  const periodKey = periodKeyFor(weekStart);
  const existing = await prisma.jobRun.findUnique({
    where: { jobType_periodKey: { jobType: BINARY_CYCLE_JOB_TYPE, periodKey } },
  });
  if (existing?.status === "COMPLETED") {
    return;
  }

  const startedAt = new Date();
  await prisma.jobRun.upsert({
    where: { jobType_periodKey: { jobType: BINARY_CYCLE_JOB_TYPE, periodKey } },
    create: {
      jobType: BINARY_CYCLE_JOB_TYPE,
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
    const weekEnd = weekEndFor(weekStart);
    const treeMembers = await prisma.binaryNode.findMany({ select: { userId: true } });

    for (const member of treeMembers) {
      await binaryCycle.closeBinaryCycleForUser(member.userId, weekStart, weekEnd);
    }

    await prisma.jobRun.update({
      where: { jobType_periodKey: { jobType: BINARY_CYCLE_JOB_TYPE, periodKey } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.jobRun.update({
      where: { jobType_periodKey: { jobType: BINARY_CYCLE_JOB_TYPE, periodKey } },
      data: { status: "FAILED", completedAt: null, error: message },
    });
    throw error;
  }
}
