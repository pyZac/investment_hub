import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { dailyRate } from "./interest-rate";

describe("dailyRate", () => {
  const createdConfigIds: string[] = [];

  afterAll(async () => {
    if (createdConfigIds.length > 0) {
      await prisma.interestRateConfig.deleteMany({
        where: { id: { in: createdConfigIds } },
      });
    }
  });

  it("divides the active monthly rate by days-in-month excluding Fridays", async () => {
    // August 2026 (Asia/Dubai): 31 days, 4 Fridays (7/14/21/28) -> divisor 27.
    const forDate = new Date("2026-08-20T06:00:00.000Z");

    const rate = await dailyRate(forDate);

    const activeConfig = await prisma.interestRateConfig.findFirstOrThrow({
      where: { effectiveTo: null },
    });
    const expected = new Prisma.Decimal(activeConfig.monthlyRate).div(27);

    expect(rate.toFixed(8)).toBe(expected.toFixed(8));
  });

  it("throws explicitly when no interest_rate_config row is active for the date", async () => {
    // Close the currently-active row so no config covers "now" or the future.
    const active = await prisma.interestRateConfig.findFirstOrThrow({
      where: { effectiveTo: null },
    });
    await prisma.interestRateConfig.update({
      where: { id: active.id },
      data: { effectiveTo: new Date("2000-01-01T00:00:00.000Z") },
    });

    try {
      await expect(dailyRate(new Date("2026-08-20T06:00:00.000Z"))).rejects.toThrow(
        /no active interest rate/i,
      );
    } finally {
      // Restore, since this row is the real seeded singleton, not a test fixture.
      await prisma.interestRateConfig.update({
        where: { id: active.id },
        data: { effectiveTo: null },
      });
    }
  });

  it("picks the rate active on the specific date across a rate-change boundary", async () => {
    // Close the current open-ended row at a fixed boundary, then open a new
    // rate starting right after it, so two disjoint windows exist in August 2026.
    const active = await prisma.interestRateConfig.findFirstOrThrow({
      where: { effectiveTo: null },
    });
    const boundary = new Date("2026-08-20T00:00:00.000Z");

    await prisma.interestRateConfig.update({
      where: { id: active.id },
      data: { effectiveTo: boundary },
    });

    const newConfig = await prisma.interestRateConfig.create({
      data: {
        monthlyRate: new Prisma.Decimal("8"),
        effectiveFrom: boundary,
        effectiveTo: null,
      },
    });
    createdConfigIds.push(newConfig.id);

    try {
      const beforeBoundary = await dailyRate(new Date("2026-08-19T06:00:00.000Z"));
      const afterBoundary = await dailyRate(new Date("2026-08-21T06:00:00.000Z"));

      // August 2026: 31 days, 4 Fridays -> divisor 27, for both windows.
      expect(beforeBoundary.toFixed(8)).toBe(
        new Prisma.Decimal(active.monthlyRate).div(27).toFixed(8),
      );
      expect(afterBoundary.toFixed(8)).toBe(new Prisma.Decimal("8").div(27).toFixed(8));
    } finally {
      // Restore original single-active-row state.
      await prisma.interestRateConfig.delete({ where: { id: newConfig.id } });
      createdConfigIds.splice(createdConfigIds.indexOf(newConfig.id), 1);
      await prisma.interestRateConfig.update({
        where: { id: active.id },
        data: { effectiveTo: null },
      });
    }
  });
});
