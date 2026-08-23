import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";
import { registerAsRoot, registerWithSponsor } from "./users";
import { adminCreditWalletB } from "./admin-credit";
import { purchasePackage } from "./investments";
import * as rankModule from "./rank";
import { runRankEvaluationCatchUp, RANK_EVALUATION_JOB_TYPE } from "./rank-evaluation-job";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
const createdInvestmentIds: string[] = [];
const createdJobRunPeriodKeys: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function getMainAdmin() {
  return prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
}

async function makeUser(label: string) {
  const user = await registerAsRoot({
    email: `rankjob-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Rank Job Test User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeSponsoredUser(sponsorId: string, label: string) {
  const user = await registerWithSponsor(sponsorId, {
    email: `rankjob-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Rank Job Sponsored User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makePackage(amount: string) {
  const pkg = await prisma.package.create({
    data: { name: `RankJobTest-${crypto.randomUUID()}`, amount, isActive: true },
  });
  createdPackageIds.push(pkg.id);
  return pkg;
}

async function fundWalletB(userId: string, amount: string) {
  const mainAdmin = await getMainAdmin();
  await adminCreditWalletB(mainAdmin.id, {
    userId,
    amount,
    reason: "Test funding.",
    idempotencyKey: `fund:${userId}:${crypto.randomUUID()}`,
  });
}

async function makePurchase(userId: string, packageId: string, forDate: Date) {
  const result = await purchasePackage(userId, {
    packageId,
    forDate,
    idempotencyKey: `purchase:${userId}:${crypto.randomUUID()}`,
  });
  createdInvestmentIds.push(result.investment.id);
  return result.investment;
}

async function giveActiveInvestment(userId: string, forDate: Date) {
  await fundWalletB(userId, "100");
  const pkg = await makePackage("100");
  await makePurchase(userId, pkg.id, forDate);
}

/** A sponsor with 2 qualified referrals and enough real MRV to hit Investor. */
async function makeQualifiedSponsor(label: string, forDate: Date) {
  const sponsor = await makeUser(label);
  await giveActiveInvestment(sponsor.id, forDate);
  const bigPkg = await makePackage("25000");
  for (let i = 0; i < 2; i++) {
    const referral = await makeSponsoredUser(sponsor.id, `${label}-ref-${i}`);
    await fundWalletB(referral.id, "25000");
    await makePurchase(referral.id, bigPkg.id, forDate);
  }
  return sponsor;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (createdJobRunPeriodKeys.length > 0) {
    await prisma.jobRun.deleteMany({
      where: { jobType: RANK_EVALUATION_JOB_TYPE, periodKey: { in: createdJobRunPeriodKeys } },
    });
    createdJobRunPeriodKeys.length = 0;
  }
});

afterAll(async () => {
  await prisma.rankForfeit.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.rankAward.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.mrvPeriod.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.savingLot.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.bvEntry.deleteMany({ where: { sourceInvestmentId: { in: createdInvestmentIds } } });
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.binaryNode.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("runRankEvaluationCatchUp", () => {
  it("catches up a multi-month gap (3 missed months), evaluating each in order", async () => {
    const septemberDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await makeQualifiedSponsor("multimonth", septemberDate);

    // Seed a COMPLETED baseline the month before September, so catch-up
    // starts exactly at September instead of "only the most recently
    // closeable month" (that path is covered by its own dedicated test
    // below) — mirrors binary-cycle-job.test.ts's own baseline-seeding
    // convention for the same reason.
    await prisma.jobRun.create({
      data: {
        jobType: RANK_EVALUATION_JOB_TYPE,
        periodKey: "2026-08",
        status: "COMPLETED",
        startedAt: new Date("2026-08-01T00:00:00.000Z"),
        completedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    createdJobRunPeriodKeys.push("2026-08");

    const today = new Date("2026-12-05T10:00:00.000Z"); // Dubai December
    await runRankEvaluationCatchUp(today);
    createdJobRunPeriodKeys.push("2026-09", "2026-10", "2026-11");

    const jobRuns = await prisma.jobRun.findMany({
      where: { jobType: RANK_EVALUATION_JOB_TYPE, periodKey: { in: ["2026-09", "2026-10", "2026-11"] } },
      orderBy: { periodKey: "asc" },
    });
    expect(jobRuns.map((r) => r.periodKey)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(jobRuns.every((r) => r.status === "COMPLETED")).toBe(true);

    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
    });
    expect(award.achievedMonth).toBe("2026-09");
  });

  it("does not reprocess an already-COMPLETED month", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await makeQualifiedSponsor("no-reprocess", forDate);

    const today = new Date("2026-10-05T10:00:00.000Z");
    await runRankEvaluationCatchUp(today);
    createdJobRunPeriodKeys.push("2026-09");

    const awardAfterFirst = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
    });

    // Re-running must not error and must not create a duplicate/second
    // evaluation of an already-COMPLETED month.
    await runRankEvaluationCatchUp(today);

    const jobRuns = await prisma.jobRun.findMany({
      where: { jobType: RANK_EVALUATION_JOB_TYPE, periodKey: "2026-09" },
    });
    expect(jobRuns).toHaveLength(1);

    const awardAfterSecond = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
    });
    expect(awardAfterSecond.id).toBe(awardAfterFirst.id);
  });

  it("on a true first-ever run (no prior job_runs row), only processes the most recently closeable month, not a backward walk", async () => {
    const priorCount = await prisma.jobRun.count({ where: { jobType: RANK_EVALUATION_JOB_TYPE } });
    expect(priorCount).toBe(0);

    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await makeQualifiedSponsor("first-ever", forDate);

    // "today" is well into October; the most recently closeable month is
    // September (October itself isn't over yet). A backward walk would try
    // to also process August, July, etc.
    const today = new Date("2026-10-05T10:00:00.000Z");
    await runRankEvaluationCatchUp(today);
    createdJobRunPeriodKeys.push("2026-09");

    const jobRuns = await prisma.jobRun.findMany({ where: { jobType: RANK_EVALUATION_JOB_TYPE } });
    expect(jobRuns).toHaveLength(1);
    expect(jobRuns[0].periodKey).toBe("2026-09");
    expect(jobRuns[0].status).toBe("COMPLETED");

    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
    });
    expect(award.achievedMonth).toBe("2026-09");
  });

  it("a failure partway through one month marks it FAILED, not COMPLETED, and does not advance past it", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsorA = await makeQualifiedSponsor("fail-a", forDate);
    const sponsorB = await makeQualifiedSponsor("fail-b", forDate);

    const today = new Date("2026-10-05T10:00:00.000Z");

    const original = rankModule.evaluateRankForUser.bind(rankModule);
    const spy = vi
      .spyOn(rankModule, "evaluateRankForUser")
      .mockImplementation(async (userId, month, evalForDate) => {
        if (userId === sponsorB.id) {
          throw new Error("simulated failure");
        }
        return original(userId, month, evalForDate);
      });

    await expect(runRankEvaluationCatchUp(today)).rejects.toThrow(/simulated failure/);
    createdJobRunPeriodKeys.push("2026-09");
    spy.mockRestore();

    const jobRun = await prisma.jobRun.findUniqueOrThrow({
      where: { jobType_periodKey: { jobType: RANK_EVALUATION_JOB_TYPE, periodKey: "2026-09" } },
    });
    expect(jobRun.status).toBe("FAILED");
    expect(jobRun.completedAt).toBeNull();
    expect(jobRun.error).toMatch(/simulated failure/);

    // Retrying (now with the real function) must succeed and complete the month.
    await runRankEvaluationCatchUp(today);
    const retried = await prisma.jobRun.findUniqueOrThrow({
      where: { jobType_periodKey: { jobType: RANK_EVALUATION_JOB_TYPE, periodKey: "2026-09" } },
    });
    expect(retried.status).toBe("COMPLETED");

    // sponsorA's award should still be correctly granted despite the
    // partial failure and retry.
    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsorA.id, rank: "Investor" } },
    });
    expect(award.achievedMonth).toBe("2026-09");
  });

  it("only processes users with an mrv_periods row for that month — a user with zero MRV that month is skipped", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    // A user with no referrals/MRV activity at all this month.
    const noMrvUser = await makeUser("no-mrv");
    await giveActiveInvestment(noMrvUser.id, forDate);

    const today = new Date("2026-10-05T10:00:00.000Z");
    await runRankEvaluationCatchUp(today);
    createdJobRunPeriodKeys.push("2026-09");

    const award = await prisma.rankAward.findFirst({ where: { userId: noMrvUser.id } });
    expect(award).toBeNull();
  });
});
