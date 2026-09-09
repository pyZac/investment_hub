import { Prisma } from "@prisma/client";

/**
 * Converts a monetary Decimal to a 2-decimal-place display string using
 * round-half-up. Display-only: the stored value keeps its full 8-decimal
 * precision regardless of what this renders. Never mutates its input —
 * decimal.js Decimals are immutable, and toDecimalPlaces returns a new
 * instance.
 */
export function toDisplay(value: Prisma.Decimal.Value): string {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

/**
 * Formats a date in the business timezone (Asia/Dubai). Forces Western
 * Arabic numerals (0-9) even under the "ar" locale via the `-u-nu-latn`
 * Unicode extension — Eastern Arabic numerals are never acceptable for
 * dates, same rule as monetary amounts (see bilingual-rtl skill).
 *
 * The timezone is a fixed literal, not read from `config.TIMEZONE` — this
 * function is called from several "use client" components (referrals-list,
 * commission-history-list, investment-list, b-exit-status-list), and
 * `config` is env-validated Proxy with no values in a browser bundle
 * (server env vars never reach the client). `config.TIMEZONE`'s own Zod
 * schema is `z.literal("Asia/Dubai")` — it can never actually be anything
 * else — so hardcoding it here isn't a behavior change, only removing a
 * needless (and client-crashing) indirection through server-only config.
 */
export function formatDate(value: Date, locale: string): string {
  const numeralSafeLocale = locale === "ar" ? "ar-u-nu-latn" : locale;
  return new Intl.DateTimeFormat(numeralSafeLocale, {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(value);
}
