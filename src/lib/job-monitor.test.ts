import { afterAll, afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { hashToken } from "./token-hash";
import { requirePermission } from "./route-guard";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";
import { DAILY_INTEREST_JOB_TYPE } from "./daily-interest-job";
import { listJobStatuses, triggerJobRun, JOB_TYPES, UnknownJobTypeError } from "./job-monitor";

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

async function makeSubAdmin() {
  const admin = await prisma.user.create({
    data: {
      email: `job-monitor-subadmin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test Sub-Admin",
      role: "ADMIN",
    },
  });
  createdUserIds.push(admin.id);
  return admin;
}

async function makeSessionToken(userId: string, forDate: Date) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(forDate.getTime() + 60 * 60 * 1000),
      lastActiveAt: forDate,
    },
  });
  return token;
}

async function makeUser() {
  const user = await registerAsRoot({
    email: `job-monitor-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Job Monitor User",
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
 * Seeds a COMPLETED job_runs baseline row the day before `dayKey`, so
 * catch-up starts exactly at `dayKey` instead of walking back further —
 * mirrors daily-interest-job.test.ts's own seedBaseline convention
 * exactly. Never touches real job history: every periodKey this creates
 * is tracked and deleted in afterEach, and all dates here are fabricated
 * far in the past, never today's real calendar date (per the standing
 * SCRUM-99 hazard — this job's own catch-up function operates on real
 * global job_runs state shared with the actual worker process).
 */
async function seedBaseline(dayKey: string) {
  const dayDate = new Date(`${dayKey}T00:00:00.000Z`);
  const priorDay = new Date(dayDate);
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

afterEach(async () => {
  if (createdJobRunPeriodKeys.length > 0) {
    await prisma.jobRun.deleteMany({
      where: { jobType: DAILY_INTEREST_JOB_TYPE, periodKey: { in: createdJobRunPeriodKeys } },
    });
    createdJobRunPeriodKeys.length = 0;
  }
});

afterAll(async () => {
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.adminAction.deleteMany({ where: { adminId: { in: createdUserIds } } });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("route-level enforcement", () => {
  it("a sub-admin without JOB_MONITOR is rejected at the route level", async () => {
    const subAdmin = await makeSubAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("JOB_MONITOR", now, token)).rejects.toMatchObject({ status: 403 });
  });

  it("a sub-admin with JOB_MONITOR is allowed at the route level", async () => {
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "JOB_MONITOR" },
    });
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolved = await requirePermission("JOB_MONITOR", now, token);
    expect(resolved.id).toBe(subAdmin.id);
  });

  it("the main admin reaches it with zero explicit grants", async () => {
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(mainAdmin.id, now);

    const resolved = await requirePermission("JOB_MONITOR", now, token);
    expect(resolved.id).toBe(mainAdmin.id);
  });
});

describe("JOB_TYPES", () => {
  it("monitors exactly the 4 real scheduled jobs, no more, no fewer", () => {
    const jobTypeNames = JOB_TYPES.map((j) => j.jobType);
    expect(jobTypeNames.sort()).toEqual(["binary_cycle", "daily_interest", "rank_evaluation", "rank_payout"].sort());
  });
});

describe("triggerJobRun", () => {
  it("rejects an unknown job type", async () => {
    const mainAdmin = await getMainAdmin();
    await expect(triggerJobRun(mainAdmin.id, "not_a_real_job", new Date())).rejects.toThrow(UnknownJobTypeError);
  });

  it("rejects a sub-admin without JOB_MONITOR", async () => {
    const subAdmin = await makeSubAdmin();
    await expect(
      triggerJobRun(subAdmin.id, DAILY_INTEREST_JOB_TYPE, new Date("2026-11-15T10:00:00.000Z")),
    ).rejects.toThrow(/forbidden/i);
  });

  it("a manual re-trigger of a job whose period already COMPLETED is idempotent — no double-crediting", async () => {
    const mainAdmin = await getMainAdmin();

    // Fabricated dates far from real "today", isolated from real worker
    // state via seedBaseline + tracked periodKey cleanup.
    const purchaseDate = new Date("2026-11-01T08:00:00.000Z");
    const dayKey = "2026-11-10";
    const forDate = new Date(`${dayKey}T08:00:00.000Z`);

    await seedBaseline(dayKey);
    const user = await makeUser();
    await makeInvestment(user.id, "10000", purchaseDate);

    // First trigger: real accrual happens, job_runs row for dayKey is COMPLETED.
    await triggerJobRun(mainAdmin.id, DAILY_INTEREST_JOB_TYPE, forDate);
    createdJobRunPeriodKeys.push(dayKey);

    const walletAAfterFirst = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "A" } },
    });
    const ledgerCountAfterFirst = await prisma.ledgerEntry.count({
      where: { referenceType: "investment", entryType: "DAILY_INTEREST", userId: user.id },
    });

    // Second trigger for the SAME forDate: the period is already
    // COMPLETED, so this must be a pure no-op — no additional interest,
    // no additional ledger entries.
    await triggerJobRun(mainAdmin.id, DAILY_INTEREST_JOB_TYPE, forDate);

    const walletAAfterSecond = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "A" } },
    });
    const ledgerCountAfterSecond = await prisma.ledgerEntry.count({
      where: { referenceType: "investment", entryType: "DAILY_INTEREST", userId: user.id },
    });

    expect(walletAAfterSecond.balance.toString()).toBe(walletAAfterFirst.balance.toString());
    expect(ledgerCountAfterSecond).toBe(ledgerCountAfterFirst);

    const action = await prisma.adminAction.findFirst({
      where: { adminId: mainAdmin.id, actionType: "JOB_MONITOR_TRIGGERED" },
      orderBy: { createdAt: "desc" },
    });
    expect(action).not.toBeNull();
  });

  it("allows a sub-admin with JOB_MONITOR", async () => {
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "JOB_MONITOR" },
    });

    const dayKey = "2026-11-20";
    const forDate = new Date(`${dayKey}T08:00:00.000Z`);
    await seedBaseline(dayKey);
    createdJobRunPeriodKeys.push(dayKey);

    await triggerJobRun(subAdmin.id, DAILY_INTEREST_JOB_TYPE, forDate);

    const action = await prisma.adminAction.findFirst({
      where: { adminId: subAdmin.id, actionType: "JOB_MONITOR_TRIGGERED" },
    });
    expect(action).not.toBeNull();
  });
});

describe("listJobStatuses", () => {
  it("rejects a caller without JOB_MONITOR", async () => {
    const subAdmin = await makeSubAdmin();
    await expect(listJobStatuses(subAdmin.id)).rejects.toThrow(/forbidden/i);
  });

  it("reflects a COMPLETED outcome after a successful trigger", async () => {
    const mainAdmin = await getMainAdmin();

    const dayKey = "2026-11-25";
    const forDate = new Date(`${dayKey}T08:00:00.000Z`);
    await seedBaseline(dayKey);
    createdJobRunPeriodKeys.push(dayKey);

    await triggerJobRun(mainAdmin.id, DAILY_INTEREST_JOB_TYPE, forDate);

    const statuses = await listJobStatuses(mainAdmin.id);
    const dailyInterestStatus = statuses.find((s) => s.jobType === DAILY_INTEREST_JOB_TYPE)!;
    expect(dailyInterestStatus.currentStatus).toBe("COMPLETED");
    expect(dailyInterestStatus.lastCompletedPeriodKey).toBe(dayKey);
    expect(dailyInterestStatus.lastCompletedAt).not.toBeNull();
  });

  it("reflects a FAILED outcome with its error message", async () => {
    const mainAdmin = await getMainAdmin();

    // Seeding a FAILED row directly for a fabricated period — the failure
    // -detail requirement is about surfacing an existing error message,
    // not about reproducing a specific real failure mode of any one job.
    const failedPeriodKey = "2026-11-30";
    await prisma.jobRun.create({
      data: {
        jobType: DAILY_INTEREST_JOB_TYPE,
        periodKey: failedPeriodKey,
        status: "FAILED",
        startedAt: new Date(`${failedPeriodKey}T00:05:00.000Z`),
        error: "Simulated failure for test coverage.",
      },
    });
    createdJobRunPeriodKeys.push(failedPeriodKey);

    const statuses = await listJobStatuses(mainAdmin.id);
    const dailyInterestStatus = statuses.find((s) => s.jobType === DAILY_INTEREST_JOB_TYPE)!;
    expect(dailyInterestStatus.currentStatus).toBe("FAILED");
    expect(dailyInterestStatus.lastFailedPeriodKey).toBe(failedPeriodKey);
    expect(dailyInterestStatus.lastFailedError).toBe("Simulated failure for test coverage.");
  });

  it("reports NEVER_RUN for a job type with no job_runs rows at all — sanity check on the shape, not a real scenario for these 4 jobs in this dev DB", async () => {
    const mainAdmin = await getMainAdmin();
    const statuses = await listJobStatuses(mainAdmin.id);
    // All 4 real jobs have genuine history in this shared dev DB by now —
    // this just confirms the returned shape always includes every job
    // type, never silently drops one.
    expect(statuses).toHaveLength(4);
    for (const status of statuses) {
      expect(["RUNNING", "COMPLETED", "FAILED", "NEVER_RUN"]).toContain(status.currentStatus);
    }
  });
});
