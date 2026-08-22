import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";
import { registerAsRoot, registerWithSponsor } from "./users";
import * as binaryCycleModule from "./binary-cycle";
import { runBinaryCycleCatchUp, BINARY_CYCLE_JOB_TYPE } from "./binary-cycle-job";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
const createdInvestmentIds: string[] = [];
const createdCycleIds: string[] = [];
const createdJobRunPeriodKeys: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeRoot(label: string) {
  const user = await registerAsRoot({
    email: `job-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: label,
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeReferral(sponsorId: string, label: string) {
  const user = await registerWithSponsor(sponsorId, {
    email: `job-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: label,
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeActiveInvestment(userId: string, amount: string) {
  const pkg = await prisma.package.create({
    data: { name: `JobTest-${crypto.randomUUID()}`, amount, isActive: true },
  });
  createdPackageIds.push(pkg.id);

  const investment = await prisma.investment.create({
    data: {
      userId,
      packageId: pkg.id,
      amount,
      purchasedAt: new Date("2026-01-01T00:00:00.000Z"),
      profitStartsAt: new Date("2026-01-08T00:00:00.000Z"),
      capitalUnlocksAt: new Date("2027-01-01T00:00:00.000Z"),
      referenceId: `job-seed:${crypto.randomUUID()}`,
    },
  });
  createdInvestmentIds.push(investment.id);
  return investment;
}

/** Minimal 2-level tree: sponsor with LEFT/RIGHT direct children, both active. */
async function makeQualifiedSponsor(label: string) {
  const sponsor = await makeRoot(label);
  const leftChild = await makeReferral(sponsor.id, `${label}-left`);
  const rightChild = await makeReferral(sponsor.id, `${label}-right`);
  await makeActiveInvestment(sponsor.id, "100");
  const leftInvestment = await makeActiveInvestment(leftChild.id, "100");
  const rightInvestment = await makeActiveInvestment(rightChild.id, "100");
  return { sponsor, leftChild, rightChild, leftInvestment, rightInvestment };
}

async function seedBvEntry(ancestorUserId: string, sourceInvestmentId: string, leg: "LEFT" | "RIGHT", amount: string, cycleWeekStart: Date) {
  await prisma.bvEntry.create({ data: { ancestorUserId, sourceInvestmentId, leg, amount, cycleWeekStart } });
}

async function trackCyclesForUsers(userIds: string[]) {
  const cycles = await prisma.binaryCycle.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  cycles.forEach((c) => createdCycleIds.push(c.id));
}

afterEach(async () => {
  vi.restoreAllMocks();
  await trackCyclesForUsers(createdUserIds);
  if (createdJobRunPeriodKeys.length > 0) {
    await prisma.jobRun.deleteMany({
      where: { jobType: BINARY_CYCLE_JOB_TYPE, periodKey: { in: createdJobRunPeriodKeys } },
    });
    createdJobRunPeriodKeys.length = 0;
  }
});

afterAll(async () => {
  await trackCyclesForUsers(createdUserIds);
  if (createdCycleIds.length > 0) {
    await prisma.binaryCycle.deleteMany({ where: { id: { in: createdCycleIds } } });
  }
  await prisma.bvEntry.deleteMany({ where: { ancestorUserId: { in: createdUserIds } } });
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.binaryNode.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("runBinaryCycleCatchUp", () => {
  it("catches up a multi-week gap (3 missed weeks) in order, each getting its own binary_cycles row", async () => {
    const { sponsor, leftInvestment, rightInvestment } = await makeQualifiedSponsor("multi-week");

    // Three consecutive Saturday-00:00-Dubai week starts (calendar Sat
    // dates 08-29, 09-05, 09-12; stamped as the preceding Friday 20:00
    // UTC, matching binary-cycle-close.test.ts's own WEEK_START convention).
    const week1 = new Date("2026-08-28T20:00:00.000Z");
    const week2 = new Date("2026-09-04T20:00:00.000Z");
    const week3 = new Date("2026-09-11T20:00:00.000Z");
    await seedBvEntry(sponsor.id, leftInvestment.id, "LEFT", "1000", week1);
    await seedBvEntry(sponsor.id, rightInvestment.id, "RIGHT", "1000", week1);

    // Seed a COMPLETED baseline the week before week1, so catch-up starts
    // exactly at week1 instead of "only the most recent week" (that path is
    // covered by its own dedicated test below).
    const baselineWeek = new Date(week1.getTime() - 7 * 24 * 60 * 60 * 1000);
    const baselineKey = baselineWeek.toISOString();
    await prisma.jobRun.create({
      data: { jobType: BINARY_CYCLE_JOB_TYPE, periodKey: baselineKey, status: "COMPLETED", startedAt: baselineWeek, completedAt: baselineWeek },
    });
    createdJobRunPeriodKeys.push(baselineKey);

    // "today" is the Saturday that closes week3 (i.e. one week after week3 starts).
    const today = new Date(week3.getTime() + 7 * 24 * 60 * 60 * 1000);

    await runBinaryCycleCatchUp(today);
    [week1, week2, week3].forEach((w) => createdJobRunPeriodKeys.push(w.toISOString()));

    const jobRuns = await prisma.jobRun.findMany({
      where: { jobType: BINARY_CYCLE_JOB_TYPE, periodKey: { in: [week1, week2, week3].map((w) => w.toISOString()) } },
      orderBy: { periodKey: "asc" },
    });
    expect(jobRuns.map((r) => r.periodKey)).toEqual([week1.toISOString(), week2.toISOString(), week3.toISOString()]);
    expect(jobRuns.every((r) => r.status === "COMPLETED")).toBe(true);

    const cycle1 = await prisma.binaryCycle.findUniqueOrThrow({
      where: { userId_weekStart: { userId: sponsor.id, weekStart: week1 } },
    });
    expect(cycle1.qualified).toBe(true);

    // Weeks 2 and 3 had no fresh BV, but still got a real (unqualified-by-
    // volume-only, still qualified-by-legs) row each — proves the batch
    // didn't skip weeks with nothing new to process.
    const cycle2 = await prisma.binaryCycle.findUnique({
      where: { userId_weekStart: { userId: sponsor.id, weekStart: week2 } },
    });
    const cycle3 = await prisma.binaryCycle.findUnique({
      where: { userId_weekStart: { userId: sponsor.id, weekStart: week3 } },
    });
    expect(cycle2).not.toBeNull();
    expect(cycle3).not.toBeNull();
  });

  it("does not reprocess an already-COMPLETED week", async () => {
    const { sponsor, leftInvestment, rightInvestment } = await makeQualifiedSponsor("no-reprocess");

    const week1 = new Date("2026-08-28T20:00:00.000Z");
    await seedBvEntry(sponsor.id, leftInvestment.id, "LEFT", "500", week1);
    await seedBvEntry(sponsor.id, rightInvestment.id, "RIGHT", "500", week1);

    const today = new Date(week1.getTime() + 7 * 24 * 60 * 60 * 1000);
    await runBinaryCycleCatchUp(today);
    createdJobRunPeriodKeys.push(week1.toISOString());

    const cyclesAfterFirst = await prisma.binaryCycle.count({ where: { userId: sponsor.id, weekStart: week1 } });
    expect(cyclesAfterFirst).toBe(1);

    // Second call for the same "today" must not touch week1 again.
    await runBinaryCycleCatchUp(today);

    const cyclesAfterSecond = await prisma.binaryCycle.count({ where: { userId: sponsor.id, weekStart: week1 } });
    expect(cyclesAfterSecond).toBe(1);

    const jobRuns = await prisma.jobRun.findMany({
      where: { jobType: BINARY_CYCLE_JOB_TYPE, periodKey: week1.toISOString() },
    });
    expect(jobRuns).toHaveLength(1);
  });

  it("on a true first-ever run (no prior job_runs row), only processes the most recently closeable week, not a backward walk", async () => {
    const { sponsor, leftInvestment, rightInvestment } = await makeQualifiedSponsor("first-ever");

    const priorCount = await prisma.jobRun.count({ where: { jobType: BINARY_CYCLE_JOB_TYPE } });
    expect(priorCount).toBe(0);

    // "today" is Dubai Saturday 00:00; the most recently closeable week is the one before it.
    const today = new Date("2026-09-11T20:00:00.000Z"); // Dubai Sat 2026-09-12
    const expectedWeek = new Date("2026-09-04T20:00:00.000Z"); // Dubai Sat 2026-09-05, the prior week
    await seedBvEntry(sponsor.id, leftInvestment.id, "LEFT", "300", expectedWeek);
    await seedBvEntry(sponsor.id, rightInvestment.id, "RIGHT", "300", expectedWeek);

    await runBinaryCycleCatchUp(today);
    createdJobRunPeriodKeys.push(expectedWeek.toISOString());

    const jobRuns = await prisma.jobRun.findMany({ where: { jobType: BINARY_CYCLE_JOB_TYPE } });
    expect(jobRuns).toHaveLength(1);
    expect(jobRuns[0].periodKey).toBe(expectedWeek.toISOString());
    expect(jobRuns[0].status).toBe("COMPLETED");

    const cycle = await prisma.binaryCycle.findUniqueOrThrow({
      where: { userId_weekStart: { userId: sponsor.id, weekStart: expectedWeek } },
    });
    expect(cycle.qualified).toBe(true);
  });

  it("a failure partway through one week marks it FAILED, not COMPLETED, and does not advance past it", async () => {
    const { sponsor: sponsorA } = await makeQualifiedSponsor("fail-a");
    const { sponsor: sponsorB, leftInvestment, rightInvestment } = await makeQualifiedSponsor("fail-b");

    const week1 = new Date("2026-08-28T20:00:00.000Z");
    await seedBvEntry(sponsorB.id, leftInvestment.id, "LEFT", "200", week1);
    await seedBvEntry(sponsorB.id, rightInvestment.id, "RIGHT", "200", week1);
    const today = new Date(week1.getTime() + 7 * 24 * 60 * 60 * 1000);

    const original = binaryCycleModule.closeBinaryCycleForUser.bind(binaryCycleModule);
    const spy = vi
      .spyOn(binaryCycleModule, "closeBinaryCycleForUser")
      .mockImplementation(async (userId, weekStart, weekEnd) => {
        if (userId === sponsorB.id) {
          throw new Error("simulated failure");
        }
        return original(userId, weekStart, weekEnd);
      });

    await expect(runBinaryCycleCatchUp(today)).rejects.toThrow(/simulated failure/);
    createdJobRunPeriodKeys.push(week1.toISOString());
    spy.mockRestore();

    const jobRun = await prisma.jobRun.findUniqueOrThrow({
      where: { jobType_periodKey: { jobType: BINARY_CYCLE_JOB_TYPE, periodKey: week1.toISOString() } },
    });
    expect(jobRun.status).toBe("FAILED");
    expect(jobRun.completedAt).toBeNull();
    expect(jobRun.error).toMatch(/simulated failure/);

    // Retrying (now with the real function) must succeed and complete the week.
    await runBinaryCycleCatchUp(today);
    const retried = await prisma.jobRun.findUniqueOrThrow({
      where: { jobType_periodKey: { jobType: BINARY_CYCLE_JOB_TYPE, periodKey: week1.toISOString() } },
    });
    expect(retried.status).toBe("COMPLETED");

    void sponsorA;
  });

  it("only processes users with a binary_nodes row — a never-placed user gets zero binary_cycles rows", async () => {
    // A root user who never sponsors anyone gets no binary_nodes row at
    // all (per binary-tree.ts's lazy-creation design).
    const neverPlaced = await makeRoot("never-placed");

    const week1 = new Date("2026-08-28T20:00:00.000Z");
    const today = new Date(week1.getTime() + 7 * 24 * 60 * 60 * 1000);

    const nodeExists = await prisma.binaryNode.findUnique({ where: { userId: neverPlaced.id } });
    expect(nodeExists).toBeNull();

    await runBinaryCycleCatchUp(today);
    createdJobRunPeriodKeys.push(week1.toISOString());

    const cycleCount = await prisma.binaryCycle.count({ where: { userId: neverPlaced.id } });
    expect(cycleCount).toBe(0);
  });
});
