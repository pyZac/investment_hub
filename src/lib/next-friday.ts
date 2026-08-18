import { isFriday } from "./interest-rate";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days remaining until the next Friday in the business timezone
 * (Asia/Dubai), relative to `now` (explicit param per invariant #4, even for
 * display-only logic). Returns 0 if `now` is already Friday there — matches
 * `daysUntil`'s convention in investments.ts (0 means "available now", never
 * a negative countdown).
 */
export function daysUntilNextFriday(now: Date): number {
  for (let offset = 0; offset < 7; offset++) {
    const candidate = new Date(now.getTime() + offset * MS_PER_DAY);
    if (isFriday(candidate)) {
      return offset;
    }
  }
  // Unreachable: every 7-day window contains a Friday.
  return 0;
}
