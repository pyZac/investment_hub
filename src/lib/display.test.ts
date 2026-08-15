import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { toDisplay } from "./display";

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
