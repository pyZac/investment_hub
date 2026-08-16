import { Prisma } from "@prisma/client";
import { config } from "./config";

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
 */
export function formatDate(value: Date, locale: string): string {
  const numeralSafeLocale = locale === "ar" ? "ar-u-nu-latn" : locale;
  return new Intl.DateTimeFormat(numeralSafeLocale, {
    timeZone: config.TIMEZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(value);
}
