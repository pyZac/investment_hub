import { config } from "./config";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SATURDAY = "Sat";

function weekdayShort(forDate: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: config.TIMEZONE,
    weekday: "short",
  }).format(forDate);
}

/**
 * The most recent Saturday 00:00 (business timezone, Asia/Dubai) at or
 * before `forDate` — the start of the weekly binary-commission cycle
 * (docs/mlm_rules_log.md Section 5: "Saturday start -> Friday close").
 * Walks back day by day (mirrors interest-rate.ts's isFriday /
 * daysInMonthExcludingFridays pattern) rather than a weekday-offset formula,
 * so it stays correct regardless of which day forDate falls on.
 *
 * Only computes the boundary stamp for bv_entries.cycle_week_start — actual
 * weekly cycle aggregation/payout logic is a separate, later piece of work.
 */
export function saturdayWeekStart(forDate: Date): Date {
  for (let offset = 0; offset < 7; offset++) {
    const candidate = new Date(forDate.getTime() - offset * MS_PER_DAY);
    if (weekdayShort(candidate) === SATURDAY) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: config.TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(candidate);
      const year = Number(parts.find((p) => p.type === "year")!.value);
      const month = Number(parts.find((p) => p.type === "month")!.value);
      const day = Number(parts.find((p) => p.type === "day")!.value);
      // Asia/Dubai is a fixed UTC+4 offset (no DST) — midnight there is
      // 20:00 UTC the prior calendar day.
      return new Date(Date.UTC(year, month - 1, day, -4, 0, 0));
    }
  }
  // Unreachable: every 7-day window contains a Saturday.
  throw new Error("No Saturday found within 7 days — this should be unreachable.");
}
