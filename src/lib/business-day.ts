export const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant that is 00:00 in Asia/Dubai on the business day containing
 * `forDate`. Dubai has a fixed UTC+4 offset with no DST (see CLAUDE.md), so
 * this is plain millisecond offset arithmetic, not an Intl-based calendar
 * walk. Shared by every function in this project that buckets `createdAt`
 * timestamps (or walks a date range) in terms of Dubai business days — do
 * not re-derive this arithmetic inline a second time.
 */
export function startOfDubaiDay(forDate: Date): Date {
  const dubaiLocalMs = forDate.getTime() + DUBAI_OFFSET_MS;
  const startOfDubaiDayLocalMs = Math.floor(dubaiLocalMs / DAY_MS) * DAY_MS;
  return new Date(startOfDubaiDayLocalMs - DUBAI_OFFSET_MS);
}

/**
 * A stable YYYY-MM-DD key for the Dubai business day containing `startOfDay`
 * (the instant returned by `startOfDubaiDay`), for grouping/lookup. Must add
 * the Dubai offset back before slicing — `startOfDay` is a UTC instant whose
 * *UTC* calendar date is one day behind the Dubai date it represents (Dubai
 * midnight = 20:00 UTC the prior day), so slicing `toISOString()` directly
 * would silently key every day one day too early. This bug shipped once
 * already (SCRUM-92's `getTodayInterestCreditA`/`getDailyInterestHistoryA`
 * bucketing) and a second, independent instance of the same mistake in
 * `daily-profit-series.ts`'s date-range walk (keying by `cursor.toISOString()
 * .slice(0, 10)` — the UTC date — instead of this function) silently
 * mismatched every key against `getDailyInterestHistoryA`'s Dubai-keyed map,
 * making real accrued interest invisible on the chart. Any code that needs a
 * business-day key for a Dubai-day instant must call this, never re-derive it.
 */
export function dubaiDayKey(startOfDay: Date): string {
  return new Date(startOfDay.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}
