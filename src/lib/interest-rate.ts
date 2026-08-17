import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { config } from "./config";

const FRIDAY = "Fri";

function businessDateParts(forDate: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.TIMEZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(forDate);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  return { year, month };
}

/**
 * True if `forDate` falls on a Friday in the business timezone. Shared by
 * `dailyRate`'s divisor calculation and per-investment accrual, which skips
 * Fridays entirely rather than accruing at zero.
 */
export function isFriday(forDate: Date): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: config.TIMEZONE,
    weekday: "short",
  }).format(forDate);
  return weekday === FRIDAY;
}

/**
 * Number of days in `forDate`'s calendar month (business timezone) that are
 * not Fridays. Walks the month day-by-day rather than computing a weekday
 * offset formula, so it stays correct regardless of which day the month
 * starts on.
 */
function daysInMonthExcludingFridays(forDate: Date): number {
  const { year, month } = businessDateParts(forDate);
  const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();

  let count = 0;
  for (let day = 1; day <= totalDays; day++) {
    // Noon UTC avoids any midnight-boundary ambiguity when formatting into a
    // fixed-offset timezone (Asia/Dubai has no DST, but this stays robust
    // even if that assumption is ever revisited).
    const dayDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (!isFriday(dayDate)) {
      count++;
    }
  }
  return count;
}

/**
 * The daily interest rate for `forDate`: the monthly rate active on that
 * specific date, divided by the number of days in that date's calendar month
 * excluding Fridays (per wallet_interest_audit_rules_log.md Section 2 — the
 * full monthly rate is realized by month's end since Fridays are a genuine
 * pause, not a shortfall). Looks up the historical rate for `forDate` rather
 * than "whatever is active now", so recalculating a past date always
 * reproduces the same result regardless of later rate changes.
 *
 * Takes `forDate` as a parameter and never calls `new Date()` internally
 * (invariant #4) — the scheduler passes real dates, tests pass fabricated
 * ones, same code path.
 */
export async function dailyRate(forDate: Date): Promise<Prisma.Decimal> {
  const activeConfig = await prisma.interestRateConfig.findFirst({
    where: {
      effectiveFrom: { lte: forDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: forDate } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });

  if (!activeConfig) {
    throw new Error(
      `No active interest rate config found for ${forDate.toISOString()}.`,
    );
  }

  const divisor = daysInMonthExcludingFridays(forDate);
  return new Prisma.Decimal(activeConfig.monthlyRate).div(divisor);
}
