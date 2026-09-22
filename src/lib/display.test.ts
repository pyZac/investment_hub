import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { toDisplay, toDisplayWithCurrency, toDisplayAmountPreview, formatDate } from "./display";

describe("toDisplay", () => {
  it("formats a standard value to 2 decimal places", () => {
    expect(toDisplay(new Prisma.Decimal("104.12345678"))).toBe("104.12");
  });

  it("rounds half up (104.995 -> 105.00)", () => {
    expect(toDisplay(new Prisma.Decimal("104.995"))).toBe("105.00");
  });

  it("rounds half up at the 8-decimal boundary (104.99500000 -> 105.00)", () => {
    expect(toDisplay(new Prisma.Decimal("104.99500000"))).toBe("105.00");
  });

  it("rounds down when the third decimal is below 5", () => {
    expect(toDisplay(new Prisma.Decimal("104.994"))).toBe("104.99");
  });

  it("formats zero as 0.00", () => {
    expect(toDisplay(new Prisma.Decimal(0))).toBe("0.00");
  });

  it("formats a whole number with trailing zeros", () => {
    expect(toDisplay(new Prisma.Decimal("100"))).toBe("100.00");
  });

  it("formats a negative value, rounding half up in magnitude away from zero", () => {
    expect(toDisplay(new Prisma.Decimal("-104.995"))).toBe("-105.00");
  });

  it("accepts a numeric string input directly", () => {
    expect(toDisplay("42.005")).toBe("42.01");
  });

  it("never mutates the original Decimal instance", () => {
    const original = new Prisma.Decimal("104.99500000");
    const originalString = original.toString();

    toDisplay(original);

    expect(original.toString()).toBe(originalString);
  });
});

describe("toDisplayWithCurrency", () => {
  it("adds a $ prefix with no thousands separator under 1000", () => {
    expect(toDisplayWithCurrency(new Prisma.Decimal("104.5"))).toBe("$104.50");
  });

  it("inserts a comma at the thousands boundary", () => {
    expect(toDisplayWithCurrency(new Prisma.Decimal("10000"))).toBe("$10,000.00");
  });

  it("inserts commas at every power of 1000 for a large value", () => {
    expect(toDisplayWithCurrency(new Prisma.Decimal("1000000"))).toBe("$1,000,000.00");
  });

  it("handles a value just under a thousands boundary", () => {
    expect(toDisplayWithCurrency(new Prisma.Decimal("999.99"))).toBe("$999.99");
  });

  it("formats zero as $0.00, no comma", () => {
    expect(toDisplayWithCurrency(new Prisma.Decimal(0))).toBe("$0.00");
  });

  it("puts the sign before the $ for a negative value, not after", () => {
    expect(toDisplayWithCurrency(new Prisma.Decimal("-1234.56"))).toBe("-$1,234.56");
  });

  it("rounds half up before formatting (104.995 -> $105.00)", () => {
    expect(toDisplayWithCurrency(new Prisma.Decimal("104.995"))).toBe("$105.00");
  });

  it("accepts a numeric string input directly", () => {
    expect(toDisplayWithCurrency("50000")).toBe("$50,000.00");
  });

  it("is idempotent-safe against an already-toDisplay'd 2dp string", () => {
    const twoDp = toDisplay(new Prisma.Decimal("12345.678"));
    expect(toDisplayWithCurrency(twoDp)).toBe("$12,345.68");
  });

  it("never mutates the original Decimal instance", () => {
    const original = new Prisma.Decimal("10000.005");
    const originalString = original.toString();

    toDisplayWithCurrency(original);

    expect(original.toString()).toBe(originalString);
  });

  it("does not change toDisplay's own output (regression guard: two independent functions, not one mutated in place)", () => {
    expect(toDisplay(new Prisma.Decimal("10000"))).toBe("10000.00");
  });
});

describe("toDisplayAmountPreview", () => {
  it("formats a valid live-input string like toDisplayWithCurrency", () => {
    expect(toDisplayAmountPreview("1000")).toBe("$1,000.00");
  });

  it("returns $0.00 for an empty string instead of throwing (regression: confirmation dialogs render this before the amount field is typed into)", () => {
    expect(toDisplayAmountPreview("")).toBe("$0.00");
  });

  it("returns $0.00 for a whitespace-only string", () => {
    expect(toDisplayAmountPreview("   ")).toBe("$0.00");
  });

  it("returns $0.00 for a non-numeric string instead of throwing", () => {
    expect(toDisplayAmountPreview("abc")).toBe("$0.00");
  });

  it("returns $0.00 for an already-formatted string instead of throwing (regression: a $-prefixed/comma string must never reach the Decimal constructor)", () => {
    expect(toDisplayAmountPreview("$1,000.00")).toBe("$0.00");
  });

  it("formats a partial in-progress decimal like '12.'", () => {
    expect(toDisplayAmountPreview("12.")).toBe("$12.00");
  });
});

describe("formatDate", () => {
  const date = new Date("2026-08-15T10:00:00.000Z");

  it("formats in English with Western numerals", () => {
    expect(formatDate(date, "en")).toMatch(/^[A-Za-z0-9 ,]+$/);
  });

  it("formats in Arabic without any Eastern Arabic numerals", () => {
    const formatted = formatDate(date, "ar");
    expect(formatted).not.toMatch(/[٠-٩]/);
  });

  it("uses Western digits for the day/year in both locales", () => {
    const en = formatDate(date, "en");
    const ar = formatDate(date, "ar");
    expect(en).toMatch(/2026/);
    expect(ar).toMatch(/2026/);
  });
});
