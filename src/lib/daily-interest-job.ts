import { prisma } from "./prisma";
import * as dailyInterest from "./daily-interest";

export const DAILY_INTEREST_JOB_TYPE = "daily_interest";

function periodKeyFor(forDate: Date): string {
  return forDate.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Every unprocessed daily-interest period from the last COMPLETED period
 * (exclusive) through `today` (inclusive), oldest first. "Unprocessed" means
 * no COMPLETED job_runs row exists for that period_key — a FAILED or missing
 * row is eligible for (re)processing. This is catch-up logic per Decision 2:
 * it asks "what periods are missing?", not "what is today?", so a server
 * that was down for 3 days catches up all 3 on the next call, in order.
 *
 * If no job_runs row exists yet at all (the job has never completed a run
 * before), there is nothing to "catch up" on — catch-up protects against a
 * job that has run before going down, not against the job never having
 * existed. The only unprocessed period on a true first run is `today` itself.
 */
async function unprocessedPeriods(today: Date): Promise<Date[]> {
  const lastCompleted = await prisma.jobRun.findFirst({
    where: { jobType: DAILY_INTEREST_JOB_TYPE, status: "COMPLETED" },
    orderBy: { periodKey: "desc" },
  });

  const end = startOfUtcDay(today);
  const start = lastCompleted
    ? addDays(startOfUtcDay(new Date(`${lastCompleted.periodKey}T00:00:00.000Z`)), 1)
    : end;

  const periods: Date[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    periods.push(cursor);
  }
  return periods;
}

/**
 * Runs daily interest accrual for every unprocessed period up to and
 * including `today`, in chronological order, for every ACTIVE investment.
 * Takes `today` as a parameter and never calls `new Date()` internally
 * (invariant #4) — the scheduler passes the real current date, tests pass
 * fabricated ones.
 *
 * Each period is recorded in `job_runs` (RUNNING -> COMPLETED/FAILED) keyed
 * by (job_type, period_key), so a period already COMPLETED is never
 * reprocessed, and a period that fails partway through stays FAILED (not
 * COMPLETED) so the next call retries it before touching any later period —
 * catch-up always proceeds strictly in order.
 */
export async function runDailyInterestCatchUp(today: Date): Promise<void> {
  const periods = await unprocessedPeriods(today);

  for (const period of periods) {
    await runOnePeriod(period);
  }
}

async function runOnePeriod(forDate: Date): Promise<void> {
  const periodKey = periodKeyFor(forDate);
  const existing = await prisma.jobRun.findUnique({
    where: { jobType_periodKey: { jobType: DAILY_INTEREST_JOB_TYPE, periodKey } },
  });
  if (existing?.status === "COMPLETED") {
    return;
  }

  const startedAt = new Date();
  await prisma.jobRun.upsert({
    where: { jobType_periodKey: { jobType: DAILY_INTEREST_JOB_TYPE, periodKey } },
    create: {
      jobType: DAILY_INTEREST_JOB_TYPE,
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
    const activeInvestments = await prisma.investment.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    });

    for (const investment of activeInvestments) {
      await dailyInterest.accrueDailyInterestForInvestment(investment.id, forDate);
    }

    await prisma.jobRun.update({
      where: { jobType_periodKey: { jobType: DAILY_INTEREST_JOB_TYPE, periodKey } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.jobRun.update({
      where: { jobType_periodKey: { jobType: DAILY_INTEREST_JOB_TYPE, periodKey } },
      data: { status: "FAILED", completedAt: null, error: message },
    });
    throw error;
  }
}
