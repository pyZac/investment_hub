import { Prisma } from "@prisma/client";

/**
 * Converts a monetary Decimal to a 2-decimal-place display string using
 * round-half-up. Display-only: the stored value keeps its full 8-decimal
 * precision regardless of what this renders. Never mutates its input —
 * decimal.js Decimals are immutable, and toDecimalPlaces returns a new
 * instance.
 *
 * Deliberately plain (no "$", no thousands separators) — several call
 * sites feed this straight into `Number(...)` for live form validation
 * (e.g. transfer-panel.tsx's withdrawable cap, wallet-card.tsx's
 * zero-check) or into a controlled `<input>`'s value; a "$10,000.00"
 * string would parse as NaN there. Use `toDisplayWithCurrency` below for
 * anything purely rendered, never read back.
 */
export function toDisplay(value: Prisma.Decimal.Value): string {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

/**
 * The same 2dp round-half-up value as `toDisplay`, formatted for
 * human-facing display with thousands separators and a "$" prefix —
 * e.g. "$10,000.00", "-$1,234.56". Built on top of `toDisplay` rather than
 * reimplementing the Decimal rounding, so the two never drift.
 *
 * The sign goes before the "$" (`-$105.00`, not `$-105.00`), matching how
 * a negative price is conventionally written. Several existing components
 * render their OWN literal "+"/"−" prefix outside a `dir="ltr"` wrapper
 * (see tasks/lessons.md's sign-ordering RTL lesson) for a CREDIT/DEBIT
 * indicator that isn't the value's own mathematical sign — this function
 * does not duplicate that: it only prefixes "$" and never emits a "+" for
 * positive values, so it's safe to use under those existing wrappers too.
 * Never routed through `Intl.NumberFormat`/`toLocaleString` — those can
 * silently switch to Eastern Arabic numerals under an "ar" locale unless
 * explicitly pinned to `-u-nu-latn`, and this project's own numerals rule
 * (money-precision skill, bilingual-rtl skill) requires Western digits
 * unconditionally; building the string by hand sidesteps that risk
 * entirely rather than needing a locale argument threaded through.
 */
export function toDisplayWithCurrency(value: Prisma.Decimal.Value): string {
  const fixed = toDisplay(value);
  const isNegative = fixed.startsWith("-");
  const unsigned = isNegative ? fixed.slice(1) : fixed;
  const [integerPart, decimalPart] = unsigned.split(".");
  const withThousands = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${isNegative ? "-" : ""}$${withThousands}.${decimalPart}`;
}

/**
 * For previewing a LIVE, possibly-empty/partial numeric `<input>` string in a
 * confirmation dialog before it's validated (e.g. a transfer/credit amount
 * field while its dialog is closed or the field hasn't been typed into yet).
 * `toDisplayWithCurrency`/`toDisplay` stay strict Decimal parsers per
 * invariant #1 (a bad value there should throw, not be silently coerced) —
 * this wrapper exists only for a JSX expression that runs on every render of
 * a mounted confirmation dialog regardless of whether it's open, where the
 * backing input state can legitimately be "" or a partial value like "12."
 * Never use this for anything that reaches a server action, ledger write, or
 * other real money calculation — those must keep using the strict functions
 * so invalid input is caught, not papered over as $0.00.
 */
export function toDisplayAmountPreview(rawInput: string): string {
  if (rawInput.trim() === "") {
    return toDisplayWithCurrency(0);
  }
  try {
    return toDisplayWithCurrency(rawInput);
  } catch {
    return toDisplayWithCurrency(0);
  }
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
