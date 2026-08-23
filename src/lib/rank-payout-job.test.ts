import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";
import { registerAsRoot, registerWithSponsor } from "./users";
import { adminCreditWalletB } from "./admin-credit";
import { purchasePackage } from "./investments";
import * as rankModule from "./rank";
import { runRankPayoutCatchUp, RANK_PAYOUT_JOB_TYPE } from "./rank-payout-job";
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
    email: `rankpayoutjob-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Rank Payout Job Test User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeSponsoredUser(sponsorId: string, label: string) {
  const user = await registerWithSponsor(sponsorId, {
    email: `rankpayoutjob-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Rank Payout Job Sponsored User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makePackage(amount: string) {
  const pkg = await prisma.package.create({
    data: { name: `RankPayoutJobTest-${crypto.randomUUID()}`, amount, isActive: true },
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

/** A sponsor with a granted, still-queued Investor award. */
async function makeQueuedInvestorAward(label: string, forDate: Date) {
  const sponsor = await makeUser(label);
  await giveActiveInvestment(sponsor.id, forDate);
  const bigPkg = await makePackage("25000");
  for (let i = 0; i < 2; i++) {
    const referral = await makeSponsoredUser(sponsor.id, `${label}-ref-${i}`);
    await fundWalletB(referral.id, "25000");
    await makePurchase(referral.id, bigPkg.id, forDate);
  }
  const month = rankModule.dubaiMonthKey(forDate);
  const result = await rankModule.evaluateRankForUser(sponsor.id, month, forDate);
  if (!result.granted) {
    throw new Error("Test setup failed: expected Investor to be granted.");
  }
  return sponsor;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (createdJobRunPeriodKeys.length > 0) {
    await prisma.jobRun.deleteMany({
      where: { jobType: RANK_PAYOUT_JOB_TYPE, periodKey: { in: createdJobRunPeriodKeys } },
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

describe("runRankPayoutCatchUp", () => {
  it("catches up a multi-week gap, paying queued awards on the correct closed week", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await makeQueuedInvestorAward("multiweek", forDate);

    // Seed a COMPLETED baseline 3 weeks before "today," so catch-up starts
    // exactly at the expected week instead of "only the most recently
    // closeable week" (its own dedicated test below) — mirrors
    // binary-cycle-job.test.ts's own baseline-seeding convention.
    const baselineWeek = new Date("2026-08-14T20:00:00.000Z"); // Dubai Sat 2026-08-15
    await prisma.jobRun.create({
      data: {
        jobType: RANK_PAYOUT_JOB_TYPE,
        periodKey: baselineWeek.toISOString(),
        status: "COMPLETED",
        startedAt: baselineWeek,
        completedAt: baselineWeek,
      },
    });
    createdJobRunPeriodKeys.push(baselineWeek.toISOString());

    const today = new Date("2026-09-11T20:00:00.000Z"); // Dubai Sat 2026-09-12
    await runRankPayoutCatchUp(today);

    const expectedWeeks = [
      "2026-08-21T20:00:00.000Z",
      "2026-08-28T20:00:00.000Z",
      "2026-09-04T20:00:00.000Z",
    ];
    expectedWeeks.forEach((w) => createdJobRunPeriodKeys.push(w));

    const jobRuns = await prisma.jobRun.findMany({
      where: { jobType: RANK_PAYOUT_JOB_TYPE, periodKey: { in: expectedWeeks } },
      orderBy: { periodKey: "asc" },
    });
    expect(jobRuns.map((r) => r.periodKey)).toEqual(expectedWeeks);
    expect(jobRuns.every((r) => r.status === "COMPLETED")).toBe(true);

    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
    });
    expect(award.creditedAt).not.toBeNull();

    const ledgerEntries = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: award.idempotencyKey },
    });
    expect(ledgerEntries).toHaveLength(2);
    const credit = ledgerEntries.find((e) => e.direction === "CREDIT")!;
    expect(credit.amount.equals("500")).toBe(true);
  });

  it("does not reprocess an already-COMPLETED week", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await makeQueuedInvestorAward("no-reprocess", forDate);

    const today = new Date("2026-09-18T20:00:00.000Z"); // Dubai Sat 2026-09-19
    await runRankPayoutCatchUp(today);
    createdJobRunPeriodKeys.push("2026-09-11T20:00:00.000Z");

    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
    });
    expect(award.creditedAt).not.toBeNull();
    const creditedAtFirst = award.creditedAt;

    // Second call must not touch this award again.
    await runRankPayoutCatchUp(today);

    const jobRuns = await prisma.jobRun.findMany({
      where: { jobType: RANK_PAYOUT_JOB_TYPE, periodKey: "2026-09-11T20:00:00.000Z" },
    });
    expect(jobRuns).toHaveLength(1);

    const awardAfterSecond = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
    });
    expect(awardAfterSecond.creditedAt).toEqual(creditedAtFirst);

    const ledgerEntries = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: award.idempotencyKey },
    });
    expect(ledgerEntries).toHaveLength(2);
  });

  it("on a true first-ever run (no prior job_runs row), only processes the most recently closeable week, not a backward walk", async () => {
    const priorCount = await prisma.jobRun.count({ where: { jobType: RANK_PAYOUT_JOB_TYPE } });
    expect(priorCount).toBe(0);

    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await makeQueuedInvestorAward("first-ever", forDate);

    const today = new Date("2026-09-18T20:00:00.000Z"); // Dubai Sat 2026-09-19
    await runRankPayoutCatchUp(today);
    createdJobRunPeriodKeys.push("2026-09-11T20:00:00.000Z");

    const jobRuns = await prisma.jobRun.findMany({ where: { jobType: RANK_PAYOUT_JOB_TYPE } });
    expect(jobRuns).toHaveLength(1);
    expect(jobRuns[0].periodKey).toBe("2026-09-11T20:00:00.000Z");
    expect(jobRuns[0].status).toBe("COMPLETED");

    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
    });
    expect(award.creditedAt).not.toBeNull();
  });

  it("a failure partway through one week marks it FAILED, not COMPLETED, and does not advance past it", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsorA = await makeQueuedInvestorAward("fail-a", forDate);
    const sponsorB = await makeQueuedInvestorAward("fail-b", forDate);

    const today = new Date("2026-09-18T20:00:00.000Z"); // Dubai Sat 2026-09-19

    const original = rankModule.payQueuedRankRewards.bind(rankModule);
    const spy = vi.spyOn(rankModule, "payQueuedRankRewards").mockImplementation(async (payoutForDate) => {
      // Pay sponsorA's award normally first, then fail before sponsorB's is
      // touched — simulated by throwing after doing sponsorA's real payout
      // via a direct single-award credit, since payQueuedRankRewards itself
      // has no per-award hook to fail mid-loop from outside.
      await prisma.rankAward.update({
        where: { userId_rank: { userId: sponsorA.id, rank: "Investor" } },
        data: { creditedAt: payoutForDate },
      });
      throw new Error("simulated failure");
    });

    await expect(runRankPayoutCatchUp(today)).rejects.toThrow(/simulated failure/);
    createdJobRunPeriodKeys.push("2026-09-11T20:00:00.000Z");
    spy.mockRestore();

    const jobRun = await prisma.jobRun.findUniqueOrThrow({
      where: {
        jobType_periodKey: { jobType: RANK_PAYOUT_JOB_TYPE, periodKey: "2026-09-11T20:00:00.000Z" },
      },
    });
    expect(jobRun.status).toBe("FAILED");
    expect(jobRun.completedAt).toBeNull();
    expect(jobRun.error).toMatch(/simulated failure/);

    // Retrying (now with the real function) must succeed and pay sponsorB's
    // still-queued award for real (sponsorA's was force-set above and stays
    // credited, not re-touched — its ledger entry is what proves that).
    await runRankPayoutCatchUp(today);
    const retried = await prisma.jobRun.findUniqueOrThrow({
      where: {
        jobType_periodKey: { jobType: RANK_PAYOUT_JOB_TYPE, periodKey: "2026-09-11T20:00:00.000Z" },
      },
    });
    expect(retried.status).toBe("COMPLETED");

    const awardB = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsorB.id, rank: "Investor" } },
    });
    expect(awardB.creditedAt).not.toBeNull();
    const ledgerEntriesB = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: awardB.idempotencyKey },
    });
    expect(ledgerEntriesB).toHaveLength(2);
  });
});
