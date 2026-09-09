import { Prisma } from "@prisma/client";
import { isFriday } from "./interest-rate";
import { DAY_MS, dubaiDayKey, startOfDubaiDay } from "./business-day";

export type DailyProfitPoint = {
  /** YYYY-MM-DD, Dubai business day. */
  date: string;
  /** null on a Friday — a genuine "no accrual is possible" gap, not a zero. */
  amount: number | null;
  isFriday: boolean;
};

/**
 * Builds one point per Dubai business day from `fromDate` to `toDate`
 * (inclusive), for the dashboard's accrual chart. Pure function over already
 * -fetched data — no DB access, no `new Date()` — so it's trivial to unit
 * test against fabricated history maps and date ranges.
 *
 * Fridays get `amount: null` unconditionally, regardless of what `history`
 * says for that day (there should never be a credit on a Friday per
 * `daily-interest.ts`'s skip logic, but even if one somehow existed, the
 * chart's job is to show the expected accrual pattern honestly — a Friday is
 * always rendered as the gap it structurally is). Every other day renders
 * its real credited amount, defaulting to 0 if `history` has no entry for it
 * — a non-Friday zero is a real (if unusual) fact worth showing as a flat
 * point, not hidden.
 *
 * `history` keys must be `YYYY-MM-DD` Dubai-day strings, matching
 * `getDailyInterestHistoryA`'s return shape exactly.
 */
export function buildDailyProfitSeries(
  history: Map<string, Prisma.Decimal>,
  fromDate: Date,
  toDate: Date,
): DailyProfitPoint[] {
  const points: DailyProfitPoint[] = [];

  // Walk in Dubai-day-aligned steps and key every point with the same
  // `dubaiDayKey` function `getDailyInterestHistoryA` uses to build `history`
  // — this must be the same key scheme on both sides, or every lookup here
  // silently misses (this exact mismatch shipped once: keying by
  // `cursor.toISOString().slice(0, 10)`, the UTC date, against a
  // Dubai-dated `history` map).
  let cursor = startOfDubaiDay(fromDate);
  const end = startOfDubaiDay(toDate);
  while (cursor.getTime() <= end.getTime()) {
    const key = dubaiDayKey(cursor);
    const friday = isFriday(cursor);

    points.push({
      date: key,
      amount: friday ? null : Number(history.get(key) ?? new Prisma.Decimal(0)),
      isFriday: friday,
    });

    cursor = new Date(cursor.getTime() + DAY_MS);
  }

  return points;
}
