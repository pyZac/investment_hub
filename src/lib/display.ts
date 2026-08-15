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
