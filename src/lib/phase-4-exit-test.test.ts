import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { runDailyInterestCatchUp, DAILY_INTEREST_JOB_TYPE } from "./daily-interest-job";

/**
 * Phase 4 exit test (SCRUM-54). Runs the real daily-interest catch-up job
 * across 90 fabricated calendar days, spanning three interest_rate_config
 * windows and multiple month boundaries, and checks the system's actual
 * ledger output against an independently-computed reference simulation
 * (plain Prisma.Decimal arithmetic written fresh here, not calling into
 * dailyRate/accrueDailyInterestForInvestment) — so this test would catch a
 * bug in the engine's own math, not just confirm the engine agrees with
 * itself.
 *
 * 90 days of daily compounding grows a principal by orders of magnitude
 * (~0.19%/day compounded ~75 times), which exceeds decimal.js's default
 * 20-significant-digit precision at the 8th decimal place once the integer
 * part passes ~10 digits. Raised for this file only, restored in afterAll so
 * it doesn't leak into other test files sharing this process.
 */
const originalPrecision = Prisma.Decimal.precision;
beforeAll(() => {
  Prisma.Decimal.set({ precision: 60 });
});
afterAll(() => {
  Prisma.Decimal.set({ precision: originalPrecision });
});

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
const createdInvestmentIds: string[] = [];
const createdConfigIds: string[] = [];
const createdJobRunPeriodKeys: string[] = [];
/** The id of whatever interest_rate_config row was active before this test
 * closed it — reopened in afterAll (see the comment there) so this test
 * doesn't permanently strip the DB of an active rate for every later test
 * in the same run. */
let closedActiveRateConfigId: string | null = null;

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeUser() {
  const user = await registerAsRoot({
    email: `exit-test-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Exit Test User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makePackage(amount: string) {
  const pkg = await prisma.package.create({
    data: { name: `Test-${crypto.randomUUID()}`, amount, isActive: true },
  });
  createdPackageIds.push(pkg.id);
  return pkg;
}

async function makeInvestment(userId: string, amount: string, purchasedAt: Date) {
  const pkg = await makePackage(amount);
  const profitStartsAt = new Date(purchasedAt);
  profitStartsAt.setUTCDate(profitStartsAt.getUTCDate() + 7);
  const capitalUnlocksAt = new Date(purchasedAt);
  capitalUnlocksAt.setUTCMonth(capitalUnlocksAt.getUTCMonth() + 6);

  const investment = await prisma.investment.create({
    data: {
      userId,
      packageId: pkg.id,
      amount,
      purchasedAt,
      profitStartsAt,
      capitalUnlocksAt,
      referenceId: `seed-purchase:${crypto.randomUUID()}`,
    },
  });
  createdInvestmentIds.push(investment.id);
  return investment;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function isFridayUtc(date: Date): boolean {
  return date.getUTCDay() === 5;
}

function daysInUtcMonthExcludingFridays(date: Date): number {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const totalDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= totalDays; day++) {
    if (!isFridayUtc(new Date(Date.UTC(year, month, day)))) {
      count++;
    }
  }
  return count;
}

/**
 * Independently-computed reference balance for a single investment across
 * the whole test window, using nothing from the daily-interest module —
 * fresh arithmetic against the same business rules stated in
 * wallet_interest_audit_rules_log.md Section 2, so agreement with the real
 * system's ledger output is a genuine cross-check, not circular.
 */
function simulateReferenceBalance(
  principal: string,
  purchasedAt: Date,
  windowStart: Date,
  windowEnd: Date,
  rateScheduleDesc: (date: Date) => string,
): Prisma.Decimal {
  const profitStartsAt = addDays(purchasedAt, 7);
  let balance = new Prisma.Decimal(principal);

  for (let cursor = windowStart; cursor <= windowEnd; cursor = addDays(cursor, 1)) {
    if (cursor < profitStartsAt) continue;
    if (isFridayUtc(cursor)) continue;

    const monthlyRate = new Prisma.Decimal(rateScheduleDesc(cursor));
    const divisor = daysInUtcMonthExcludingFridays(cursor);
    // monthlyRate is a plain percentage number (5 means "5%"), so it needs
    // /100 to become a true fractional multiplier — matches dailyRate()'s
    // own conversion in interest-rate.ts.
    const dailyRateValue = monthlyRate.div(divisor).div(100);
    // The real system stores each day's credited amount in a
    // NUMERIC(24,8) column, then re-reads that rounded value as the base
    // for the next day's compounding (accrueDailyInterestForInvestment sums
    // prior DAILY_INTEREST credits straight from the DB). Rounding here to
    // match is what makes this an honest reference for exact 8dp equality
    // over many compounding days — comparing against unrounded arithmetic
    // would diverge from the real (correct) persisted behavior.
    const interest = balance.mul(dailyRateValue).toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
    balance = balance.add(interest);
  }

  return balance;
}

async function disableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" DISABLE TRIGGER ledger_entries_no_delete`);
}
async function enableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" ENABLE TRIGGER ledger_entries_no_delete`);
}

afterAll(async () => {
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await disableDeleteTrigger();
  await prisma.ledgerEntry.deleteMany({
    where: { referenceType: "investment", referenceId: { in: createdInvestmentIds } },
  });
  await enableDeleteTrigger();
  if (createdJobRunPeriodKeys.length > 0) {
    await prisma.jobRun.deleteMany({
      where: { jobType: DAILY_INTEREST_JOB_TYPE, periodKey: { in: createdJobRunPeriodKeys } },
    });
  }
  if (createdConfigIds.length > 0) {
    await prisma.interestRateConfig.deleteMany({ where: { id: { in: createdConfigIds } } });
  }
  // Reopen whatever row this test closed to make room for its own two
  // fabricated windows (rate5/rate7, deleted above by id) — without this,
  // the DB is left with NO active interest_rate_config row at all after
  // this test runs, which breaks every other test/real code path that
  // expects dailyRate()/getCurrentRate() to always find one. This is the
  // same restore-what-you-touched discipline every other test file in this
  // project already follows for shared singleton config rows (see
  // rate-config.test.ts's withRestoredActiveRate, interest-rate.test.ts's
  // own finally-block restore).
  if (closedActiveRateConfigId) {
    await prisma.interestRateConfig.update({
      where: { id: closedActiveRateConfigId },
      data: { effectiveTo: null },
    });
  }
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("Phase 4 exit test — 90 fabricated days", () => {
  it("runs a full 90-day simulation and verifies every stated invariant", async () => {
    // --- Setup: two investments, two different users, offset purchase dates,
    // spanning a rate change and multiple month boundaries. ---
    const userA = await makeUser();
    const userB = await makeUser();

    const windowStart = new Date("2026-08-15T00:00:00.000Z");
    const windowEnd = addDays(windowStart, 89); // 90 days inclusive: day 0..89.

    const investmentA = await makeInvestment(userA.id, "1000", windowStart);
    const purchasedAtB = addDays(windowStart, 17); // 2026-09-01
    const investmentB = await makeInvestment(userB.id, "2000", purchasedAtB);

    // Rate schedule: 5% until 2026-10-01 (exclusive), then 7% from then on.
    // Replaces whatever config exists (from SCRUM-48's seed) with a clean,
    // fully-scoped pair of windows for this test's date range.
    const rateChangeDate = new Date("2026-10-01T00:00:00.000Z");
    const existingActive = await prisma.interestRateConfig.findFirst({ where: { effectiveTo: null } });
    if (existingActive) {
      closedActiveRateConfigId = existingActive.id;
      await prisma.interestRateConfig.update({
        where: { id: existingActive.id },
        data: { effectiveTo: windowStart },
      });
    }
    const rate5 = await prisma.interestRateConfig.create({
      data: { monthlyRate: "5", effectiveFrom: windowStart, effectiveTo: rateChangeDate },
    });
    createdConfigIds.push(rate5.id);
    const rate7 = await prisma.interestRateConfig.create({
      data: { monthlyRate: "7", effectiveFrom: rateChangeDate, effectiveTo: null },
    });
    createdConfigIds.push(rate7.id);

    const rateScheduleDesc = (date: Date) => (date < rateChangeDate ? "5" : "7");

    // runDailyInterestCatchUp queries ALL status=ACTIVE investments, not just
    // this test's — on a shared dev DB (no isolated test DB, per
    // lessons.md), any pre-existing real investment whose profit_starts_at
    // falls inside this test's 90-day fabricated window would otherwise get
    // real interest credited against it. Suspend every other user for the
    // test's duration so accrueDailyInterestForInvestment's owner_suspended
    // skip excludes their investments; restore exactly the users this test
    // suspended afterward, verified by id (never a blanket "unsuspend
    // everyone", which could wrongly reinstate an already-suspended user).
    const otherActiveInvestmentOwners = await prisma.user.findMany({
      where: {
        suspendedAt: null,
        id: { notIn: [userA.id, userB.id] },
        investments: { some: { status: "ACTIVE" } },
      },
      select: { id: true },
    });
    const suspendedForTest = otherActiveInvestmentOwners.map((u) => u.id);
    if (suspendedForTest.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: suspendedForTest } },
        data: { suspendedAt: windowStart },
      });
    }

    try {
      // --- Run the real system, one day at a time across the whole window,
      // exercising the actual catch-up scheduler entry point. ---
      for (let cursor = windowStart; cursor <= windowEnd; cursor = addDays(cursor, 1)) {
        await runDailyInterestCatchUp(cursor);
        createdJobRunPeriodKeys.push(cursor.toISOString().slice(0, 10));
      }

      // --- Invariant: no accrual before day 8 (profit_starts_at = purchase + 7d). ---
      // Direct check: no DAILY_INTEREST entry has an idempotency key dated
      // before profitStartsAt for either investment.
      const allEntriesA = await prisma.ledgerEntry.findMany({
        where: { referenceType: "investment", referenceId: investmentA.id, entryType: "DAILY_INTEREST" },
        select: { idempotencyKey: true },
      });
      const allEntriesB = await prisma.ledgerEntry.findMany({
        where: { referenceType: "investment", referenceId: investmentB.id, entryType: "DAILY_INTEREST" },
        select: { idempotencyKey: true },
      });
      const profitStartA = addDays(windowStart, 7);
      const profitStartB = addDays(purchasedAtB, 7);
      const dateFromKey = (key: string) => new Date(`${key.split(":").pop()}T00:00:00.000Z`);

      expect(allEntriesA.every((e) => dateFromKey(e.idempotencyKey) >= profitStartA)).toBe(true);
      expect(allEntriesB.every((e) => dateFromKey(e.idempotencyKey) >= profitStartB)).toBe(true);

      // Each accrual day writes exactly 2 entries (CREDIT + DEBIT), so the
      // total row count should be exactly double the unique-day count — a
      // cheap structural check against silent duplication.
      const uniqueDaysA = new Set(allEntriesA.map((e) => e.idempotencyKey)).size;
      const uniqueDaysB = new Set(allEntriesB.map((e) => e.idempotencyKey)).size;
      expect(allEntriesA.length).toBe(uniqueDaysA * 2);
      expect(allEntriesB.length).toBe(uniqueDaysB * 2);

      // --- Invariant: no Friday ever accrues (checked on both investments' entries). ---
      const anyFridayEntryA = allEntriesA.some((e) => isFridayUtc(dateFromKey(e.idempotencyKey)));
      const anyFridayEntryB = allEntriesB.some((e) => isFridayUtc(dateFromKey(e.idempotencyKey)));
      expect(anyFridayEntryA).toBe(false);
      expect(anyFridayEntryB).toBe(false);

      // --- Invariant: exact expected totals to 8 decimal places, against an
      // independently-computed reference (not the engine's own functions). ---
      const expectedBalanceA = simulateReferenceBalance(
        "1000",
        windowStart,
        windowStart,
        windowEnd,
        rateScheduleDesc,
      );
      const expectedBalanceB = simulateReferenceBalance(
        "2000",
        purchasedAtB,
        windowStart,
        windowEnd,
        rateScheduleDesc,
      );

      // wallet: "A", direction: "CREDIT" is required — DAILY_INTEREST also
      // writes a paired SYSTEM_EXTERNAL DEBIT entry tagged with the same
      // referenceType/referenceId (double-entry bookkeeping), so an
      // unfiltered aggregate would sum both sides and double-count.
      const sumA = await prisma.ledgerEntry.aggregate({
        where: {
          referenceType: "investment",
          referenceId: investmentA.id,
          entryType: "DAILY_INTEREST",
          wallet: "A",
          direction: "CREDIT",
        },
        _sum: { amount: true },
      });
      const sumB = await prisma.ledgerEntry.aggregate({
        where: {
          referenceType: "investment",
          referenceId: investmentB.id,
          entryType: "DAILY_INTEREST",
          wallet: "A",
          direction: "CREDIT",
        },
        _sum: { amount: true },
      });
      const actualBalanceA = new Prisma.Decimal("1000").add(sumA._sum.amount ?? 0);
      const actualBalanceB = new Prisma.Decimal("2000").add(sumB._sum.amount ?? 0);

      expect(actualBalanceA.toFixed(8)).toBe(expectedBalanceA.toFixed(8));
      expect(actualBalanceB.toFixed(8)).toBe(expectedBalanceB.toFixed(8));

      // --- Invariant: each investment compounds on its OWN running balance —
      // not shared across investments or users. Proven structurally: A's
      // principal (1000) and B's principal (2000) grew by different
      // multiples over different day-counts (B started 17 days later), so if
      // the engine were summing a combined balance per user or globally,
      // these two independently-derived references would not both match.
      // Explicit cross-check: A and B's growth multiples differ.
      const growthMultipleA = actualBalanceA.div("1000");
      const growthMultipleB = actualBalanceB.div("2000");
      expect(growthMultipleA.eq(growthMultipleB)).toBe(false);

      // --- Invariant: the rate change applied to the ALREADY-ACTIVE
      // investment (A, purchased before the change) starting the very next
      // day, not just to investments purchased after it. Verified by
      // checking A's own credited amount on the last day before the change
      // vs. the first day at/after the change reflects the new 7% monthly
      // rate divisor, not 5%. Reconstruct the two amounts from stored
      // entries and confirm they used different monthly rates.
      const dayBeforeChange = addDays(rateChangeDate, -1); // 2026-09-30
      const dayOfChange = rateChangeDate; // 2026-10-01
      const keyBefore = `daily_interest:${userA.id}:${investmentA.id}:${dayBeforeChange
        .toISOString()
        .slice(0, 10)}`;
      const keyAfter = `daily_interest:${userA.id}:${investmentA.id}:${dayOfChange
        .toISOString()
        .slice(0, 10)}`;
      const entryBefore = await prisma.ledgerEntry.findFirst({
        where: { idempotencyKey: keyBefore, direction: "CREDIT" },
      });
      const entryAfter = await prisma.ledgerEntry.findFirst({
        where: { idempotencyKey: keyAfter, direction: "CREDIT" },
      });
      expect(entryBefore).not.toBeNull();
      expect(entryAfter).not.toBeNull();

      // Reconstruct each day's balance-at-start-of-day from the reference
      // simulation to back out the effective daily rate actually applied,
      // and confirm it matches 5%/divisor before, 7%/divisor at-and-after.
      const balanceStartOfDayBefore = simulateReferenceBalance(
        "1000",
        windowStart,
        windowStart,
        addDays(dayBeforeChange, -1),
        rateScheduleDesc,
      );
      const balanceStartOfDayAfter = simulateReferenceBalance(
        "1000",
        windowStart,
        windowStart,
        addDays(dayOfChange, -1),
        rateScheduleDesc,
      );
      const impliedDailyRateBefore = new Prisma.Decimal(entryBefore!.amount).div(balanceStartOfDayBefore);
      const impliedDailyRateAfter = new Prisma.Decimal(entryAfter!.amount).div(balanceStartOfDayAfter);
      const expectedDailyRateBefore = new Prisma.Decimal("5").div(daysInUtcMonthExcludingFridays(dayBeforeChange)).div(100);
      const expectedDailyRateAfter = new Prisma.Decimal("7").div(daysInUtcMonthExcludingFridays(dayOfChange)).div(100);

      expect(impliedDailyRateBefore.toFixed(10)).toBe(expectedDailyRateBefore.toFixed(10));
      expect(impliedDailyRateAfter.toFixed(10)).toBe(expectedDailyRateAfter.toFixed(10));

      // --- Invariant: re-running the job for an already-processed date
      // creates no duplicate entries. ---
      const countBeforeReplay = await prisma.ledgerEntry.count({
        where: { referenceType: "investment", referenceId: { in: [investmentA.id, investmentB.id] } },
      });
      await runDailyInterestCatchUp(windowEnd);
      const countAfterReplay = await prisma.ledgerEntry.count({
        where: { referenceType: "investment", referenceId: { in: [investmentA.id, investmentB.id] } },
      });
      expect(countAfterReplay).toBe(countBeforeReplay);

      const jobRun = await prisma.jobRun.findUniqueOrThrow({
        where: {
          jobType_periodKey: {
            jobType: DAILY_INTEREST_JOB_TYPE,
            periodKey: windowEnd.toISOString().slice(0, 10),
          },
        },
      });
      expect(jobRun.status).toBe("COMPLETED");

      console.log("=== Phase 4 exit test results ===");
      console.log(`Window: ${windowStart.toISOString().slice(0, 10)} .. ${windowEnd.toISOString().slice(0, 10)} (90 days)`);
      console.log(`Investment A (purchased ${windowStart.toISOString().slice(0, 10)}, principal 1000): final balance ${actualBalanceA.toFixed(8)}`);
      console.log(`Investment B (purchased ${purchasedAtB.toISOString().slice(0, 10)}, principal 2000): final balance ${actualBalanceB.toFixed(8)}`);
      console.log(`Ledger entries for A: ${allEntriesA.length}, for B: ${allEntriesB.length}`);
      console.log(`Rate before change (2026-09-30, 5%/26): ${expectedDailyRateBefore.toFixed(10)}`);
      console.log(`Rate at/after change (2026-10-01, 7%/26): ${expectedDailyRateAfter.toFixed(10)}`);
      console.log("All invariants verified: no pre-day-8 accrual, no Friday accrual, per-investment compounding, exact 8dp totals, mid-run rate change applied to pre-existing investment, replay-safe.");
    } finally {
      // Restore the original single-active-row interest_rate_config state.
      // rate7 (this test's currently-open row) must be closed first — only
      // one row may have effective_to IS NULL at a time.
      if (existingActive) {
        await prisma.interestRateConfig.update({
          where: { id: rate7.id },
          data: { effectiveTo: new Date() },
        });
        await prisma.interestRateConfig.update({
          where: { id: existingActive.id },
          data: { effectiveTo: null },
        });
      }

      if (suspendedForTest.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: suspendedForTest } },
          data: { suspendedAt: null },
        });
      }
    }
  }, 120000);
});
