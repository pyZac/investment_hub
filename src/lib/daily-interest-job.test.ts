import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import * as dailyInterestModule from "./daily-interest";
import { runDailyInterestCatchUp, DAILY_INTEREST_JOB_TYPE } from "./daily-interest-job";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
const createdInvestmentIds: string[] = [];
const createdJobRunPeriodKeys: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeUser() {
  const user = await registerAsRoot({
    email: `job-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Job User",
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

async function makeInvestment(userId: string, packageAmount: string, purchasedAt: Date) {
  const pkg = await makePackage(packageAmount);
  const profitStartsAt = new Date(purchasedAt);
  profitStartsAt.setUTCDate(profitStartsAt.getUTCDate() + 7);
  const capitalUnlocksAt = new Date(purchasedAt);
  capitalUnlocksAt.setUTCMonth(capitalUnlocksAt.getUTCMonth() + 6);

  const investment = await prisma.investment.create({
    data: {
      userId,
      packageId: pkg.id,
      amount: packageAmount,
      purchasedAt,
      profitStartsAt,
      capitalUnlocksAt,
      referenceId: `seed-purchase:${crypto.randomUUID()}`,
    },
  });
  createdInvestmentIds.push(investment.id);
  return investment;
}

/**
 * Seeds a COMPLETED job_runs row for the day before `firstGapDay`, so
 * catch-up starts exactly at `firstGapDay` instead of walking back to
 * JOB_EPOCH (which predates the interest_rate_config seed row's
 * effective_from and would fail with "no active rate"). Mirrors realistic
 * production state: catch-up logic only matters once the job has run
 * successfully at least once before.
 */
async function seedBaseline(firstGapDay: string) {
  const firstGapDate = new Date(`${firstGapDay}T00:00:00.000Z`);
  const priorDay = new Date(firstGapDate);
  priorDay.setUTCDate(priorDay.getUTCDate() - 1);
  const priorDayKey = priorDay.toISOString().slice(0, 10);

  await prisma.jobRun.create({
    data: {
      jobType: DAILY_INTEREST_JOB_TYPE,
      periodKey: priorDayKey,
      status: "COMPLETED",
      startedAt: priorDay,
      completedAt: priorDay,
    },
  });
  createdJobRunPeriodKeys.push(priorDayKey);
}

async function disableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" DISABLE TRIGGER ledger_entries_no_delete`);
}

async function enableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" ENABLE TRIGGER ledger_entries_no_delete`);
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (createdJobRunPeriodKeys.length > 0) {
    await prisma.jobRun.deleteMany({
      where: { jobType: DAILY_INTEREST_JOB_TYPE, periodKey: { in: createdJobRunPeriodKeys } },
    });
    createdJobRunPeriodKeys.length = 0;
  }
});

afterAll(async () => {
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await disableDeleteTrigger();
  await prisma.ledgerEntry.deleteMany({
    where: { referenceType: "investment", referenceId: { in: createdInvestmentIds } },
  });
  await enableDeleteTrigger();
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("runDailyInterestCatchUp", () => {
  it("catches up a multi-day gap (including a Friday) in order, starting from scratch", async () => {
    const user = await makeUser();
    // purchased far enough back that profitStartsAt predates the whole gap.
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-01T00:00:00.000Z"));

    // Gap: 2026-08-19 (Wed) through 2026-08-22 (Sat), inclusive. 08-21 is a Friday.
    const today = new Date("2026-08-22T06:00:00.000Z");
    await seedBaseline("2026-08-19");

    await runDailyInterestCatchUp(today);
    const gapDays = ["2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"];
    gapDays.forEach((k) => createdJobRunPeriodKeys.push(k));

    const jobRuns = await prisma.jobRun.findMany({
      where: { jobType: DAILY_INTEREST_JOB_TYPE, periodKey: { in: gapDays } },
      orderBy: { periodKey: "asc" },
    });
    expect(jobRuns.map((r) => r.periodKey)).toEqual([
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
    ]);
    expect(jobRuns.every((r) => r.status === "COMPLETED")).toBe(true);
    expect(jobRuns.every((r) => r.completedAt !== null)).toBe(true);

    // Friday (08-21) completed as a job run, but produced no interest entries.
    const fridayEntries = await prisma.ledgerEntry.findMany({
      where: {
        referenceType: "investment",
        referenceId: investment.id,
        idempotencyKey: `daily_interest:${user.id}:${investment.id}:2026-08-21`,
      },
    });
    expect(fridayEntries).toHaveLength(0);

    // The three non-Friday days each produced exactly one credit entry, and
    // they compounded in chronological order (day 3's amount != day 1's).
    const day1 = await prisma.ledgerEntry.findFirst({
      where: { idempotencyKey: `daily_interest:${user.id}:${investment.id}:2026-08-19` },
    });
    const day3 = await prisma.ledgerEntry.findFirst({
      where: { idempotencyKey: `daily_interest:${user.id}:${investment.id}:2026-08-22` },
    });
    expect(day1).not.toBeNull();
    expect(day3).not.toBeNull();
    expect(new Prisma.Decimal(day1!.amount).eq(new Prisma.Decimal(day3!.amount))).toBe(false);
  });

  it("on a true first-ever run (no prior job_runs row), only processes today — no backward walk", async () => {
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-01T00:00:00.000Z"));
    // No seedBaseline call: this is the "job has never run before" case.
    const today = new Date("2026-08-20T06:00:00.000Z");

    const priorCount = await prisma.jobRun.count({ where: { jobType: DAILY_INTEREST_JOB_TYPE } });
    expect(priorCount).toBe(0);

    await runDailyInterestCatchUp(today);
    createdJobRunPeriodKeys.push("2026-08-20");

    const jobRuns = await prisma.jobRun.findMany({ where: { jobType: DAILY_INTEREST_JOB_TYPE } });
    expect(jobRuns).toHaveLength(1);
    expect(jobRuns[0].periodKey).toBe("2026-08-20");
    expect(jobRuns[0].status).toBe("COMPLETED");

    const entries = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: `daily_interest:${user.id}:${investment.id}:2026-08-20` },
    });
    expect(entries).toHaveLength(2);
  });

  it("does not reprocess a day already recorded as COMPLETED", async () => {
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-01T00:00:00.000Z"));
    const today = new Date("2026-08-20T06:00:00.000Z");
    await seedBaseline("2026-08-20");

    await runDailyInterestCatchUp(today);
    createdJobRunPeriodKeys.push("2026-08-20");

    const entriesAfterFirstRun = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: `daily_interest:${user.id}:${investment.id}:2026-08-20` },
    });
    expect(entriesAfterFirstRun).toHaveLength(2);

    // Second call for the same "today" must not touch that day again.
    await runDailyInterestCatchUp(today);

    const entriesAfterSecondRun = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: `daily_interest:${user.id}:${investment.id}:2026-08-20` },
    });
    expect(entriesAfterSecondRun).toHaveLength(2);

    const jobRuns = await prisma.jobRun.findMany({
      where: { jobType: DAILY_INTEREST_JOB_TYPE, periodKey: "2026-08-20" },
    });
    expect(jobRuns).toHaveLength(1);
  });

  it("a failure partway through one day marks it FAILED, not COMPLETED, and does not advance past it", async () => {
    const user = await makeUser();
    const investmentA = await makeInvestment(user.id, "1000", new Date("2026-08-01T00:00:00.000Z"));
    const investmentB = await makeInvestment(user.id, "1000", new Date("2026-08-01T00:00:00.000Z"));
    const today = new Date("2026-08-20T06:00:00.000Z");
    await seedBaseline("2026-08-20");

    const original = dailyInterestModule.accrueDailyInterestForInvestment.bind(dailyInterestModule);
    const spy = vi
      .spyOn(dailyInterestModule, "accrueDailyInterestForInvestment")
      .mockImplementation(async (investmentId, forDate) => {
        if (investmentId === investmentB.id) {
          throw new Error("simulated failure");
        }
        return original(investmentId, forDate);
      });

    await expect(runDailyInterestCatchUp(today)).rejects.toThrow(/simulated failure/);
    createdJobRunPeriodKeys.push("2026-08-20");
    spy.mockRestore();

    const jobRun = await prisma.jobRun.findUniqueOrThrow({
      where: { jobType_periodKey: { jobType: DAILY_INTEREST_JOB_TYPE, periodKey: "2026-08-20" } },
    });
    expect(jobRun.status).toBe("FAILED");
    expect(jobRun.completedAt).toBeNull();
    expect(jobRun.error).toMatch(/simulated failure/);

    // Retrying (now with the real function) must succeed and complete the day.
    await runDailyInterestCatchUp(today);
    const retried = await prisma.jobRun.findUniqueOrThrow({
      where: { jobType_periodKey: { jobType: DAILY_INTEREST_JOB_TYPE, periodKey: "2026-08-20" } },
    });
    expect(retried.status).toBe("COMPLETED");
  });
});
