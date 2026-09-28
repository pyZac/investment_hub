import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";
import {
  getFridayBypassStatus,
  setFridayBypass,
  findInvestmentForSimulation,
  listActiveInvestmentsForSimulation,
  simulateDailyInterestDays,
  InvestmentNotFoundError,
  InvalidSimulationDaysError,
} from "./developer-tools";
import { DEVELOPER_TOOLS_SETTINGS_ID } from "./developer-tools-constants";
import { accrueDailyInterestForInvestment } from "./daily-interest";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
const createdInvestmentIds: string[] = [];

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
      email: `dev-tools-subadmin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test Sub-Admin",
      role: "ADMIN",
    },
  });
  createdUserIds.push(admin.id);
  return admin;
}

async function makeUser(label = "dev-tools-sim") {
  const user = await registerAsRoot({
    email: `${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Simulation Test User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makePackage(amount: string) {
  const pkg = await prisma.package.create({
    data: { name: `DevToolsSim-${crypto.randomUUID()}`, amount, isActive: true },
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
      referenceId: `dev-tools-sim-seed:${crypto.randomUUID()}`,
    },
  });
  createdInvestmentIds.push(investment.id);
  return investment;
}

async function disableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" DISABLE TRIGGER ledger_entries_no_delete`);
}
async function enableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" ENABLE TRIGGER ledger_entries_no_delete`);
}

afterEach(async () => {
  // Restore the real shared singleton row to its default (off, unattributed)
  // after every test — other test files assume the Friday gate is genuinely
  // active unless they turn the bypass on themselves.
  await prisma.developerToolsSetting.update({
    where: { id: DEVELOPER_TOOLS_SETTINGS_ID },
    data: { bypassFridayGate: false, updatedByAdminId: null },
  });
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
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.adminAction.deleteMany({ where: { adminId: { in: createdUserIds } } });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("getFridayBypassStatus / setFridayBypass", () => {
  it("rejects a sub-admin without DEVELOPER_TOOLS", async () => {
    const subAdmin = await makeSubAdmin();
    await expect(getFridayBypassStatus(subAdmin.id)).rejects.toThrow(/forbidden/i);
    await expect(setFridayBypass(subAdmin.id, true)).rejects.toThrow(/forbidden/i);
  });

  it("allows a sub-admin with DEVELOPER_TOOLS", async () => {
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "DEVELOPER_TOOLS" },
    });

    await expect(setFridayBypass(subAdmin.id, true)).resolves.not.toThrow();
  });

  it("the main admin reaches it with zero explicit grants", async () => {
    const mainAdmin = await getMainAdmin();
    await expect(getFridayBypassStatus(mainAdmin.id)).resolves.not.toThrow();
  });

  it("defaults to disabled with no attribution", async () => {
    const mainAdmin = await getMainAdmin();
    const status = await getFridayBypassStatus(mainAdmin.id);
    expect(status.enabled).toBe(false);
  });

  it("turning it on is reflected immediately in getFridayBypassStatus, with the acting admin attributed", async () => {
    const mainAdmin = await getMainAdmin();

    await setFridayBypass(mainAdmin.id, true);

    const status = await getFridayBypassStatus(mainAdmin.id);
    expect(status.enabled).toBe(true);
    expect(status.updatedByAdminName).toBe(mainAdmin.name);
  });

  it("turning it back off is reflected immediately", async () => {
    const mainAdmin = await getMainAdmin();

    await setFridayBypass(mainAdmin.id, true);
    await setFridayBypass(mainAdmin.id, false);

    const status = await getFridayBypassStatus(mainAdmin.id);
    expect(status.enabled).toBe(false);
  });

  it("logs FRIDAY_GATE_BYPASS_TOGGLED to admin_actions, attributable to the acting admin", async () => {
    const mainAdmin = await getMainAdmin();

    await setFridayBypass(mainAdmin.id, true);

    const action = await prisma.adminAction.findFirst({
      where: { adminId: mainAdmin.id, actionType: "FRIDAY_GATE_BYPASS_TOGGLED" },
      orderBy: { createdAt: "desc" },
    });
    expect(action).not.toBeNull();
    expect(action!.reason).toMatch(/ON/);
  });

  it("attributes a second toggle to a different admin correctly (updatedByAdminId is the LAST admin to touch it, not the first)", async () => {
    const mainAdmin = await getMainAdmin();
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "DEVELOPER_TOOLS" },
    });

    await setFridayBypass(mainAdmin.id, true);
    await setFridayBypass(subAdmin.id, false);

    const status = await getFridayBypassStatus(mainAdmin.id);
    expect(status.updatedByAdminName).toBe(subAdmin.name);
  });
});

describe("findInvestmentForSimulation", () => {
  it("rejects a sub-admin without DEVELOPER_TOOLS", async () => {
    const subAdmin = await makeSubAdmin();
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-13T00:00:00.000Z"));

    await expect(findInvestmentForSimulation(subAdmin.id, investment.id)).rejects.toThrow(/forbidden/i);
  });

  it("throws InvestmentNotFoundError for a nonexistent id", async () => {
    const mainAdmin = await getMainAdmin();
    await expect(findInvestmentForSimulation(mainAdmin.id, "nonexistent-id")).rejects.toThrow(
      InvestmentNotFoundError,
    );
  });

  it("returns the owner name/email, package name, amount, and status", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-13T00:00:00.000Z"));

    const summary = await findInvestmentForSimulation(mainAdmin.id, investment.id);
    expect(summary.ownerName).toBe(user.name);
    expect(summary.ownerEmail).toBe(user.email);
    expect(new Prisma.Decimal(summary.amount).eq("1000")).toBe(true);
    expect(summary.status).toBe("ACTIVE");
  });
});

describe("listActiveInvestmentsForSimulation", () => {
  it("rejects a sub-admin without DEVELOPER_TOOLS", async () => {
    const subAdmin = await makeSubAdmin();
    const user = await makeUser();
    await makeInvestment(user.id, "1000", new Date("2026-08-13T00:00:00.000Z"));

    await expect(listActiveInvestmentsForSimulation(subAdmin.id, user.id)).rejects.toThrow(/forbidden/i);
  });

  it("returns only the target user's ACTIVE investments, newest first", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const older = await makeInvestment(user.id, "1000", new Date("2026-08-01T00:00:00.000Z"));
    const newer = await makeInvestment(user.id, "2000", new Date("2026-08-10T00:00:00.000Z"));

    const rows = await listActiveInvestmentsForSimulation(mainAdmin.id, user.id);
    expect(rows.map((r) => r.id)).toEqual([newer.id, older.id]);
    expect(rows.every((r) => r.status === "ACTIVE")).toBe(true);
  });

  it("excludes a CAPITAL_RELEASED investment", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const active = await makeInvestment(user.id, "1000", new Date("2026-08-01T00:00:00.000Z"));
    const released = await makeInvestment(user.id, "500", new Date("2026-08-05T00:00:00.000Z"));
    await prisma.investment.update({
      where: { id: released.id },
      data: { status: "CAPITAL_RELEASED", capitalReleasedAt: new Date("2026-09-01T00:00:00.000Z") },
    });

    const rows = await listActiveInvestmentsForSimulation(mainAdmin.id, user.id);
    expect(rows.map((r) => r.id)).toEqual([active.id]);
  });

  it("never includes another user's investments", async () => {
    const mainAdmin = await getMainAdmin();
    const targetUser = await makeUser();
    const otherUser = await makeUser();
    await makeInvestment(otherUser.id, "1000", new Date("2026-08-01T00:00:00.000Z"));

    const rows = await listActiveInvestmentsForSimulation(mainAdmin.id, targetUser.id);
    expect(rows).toEqual([]);
  });

  it("returns an empty array for a user with no investments at all", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();

    const rows = await listActiveInvestmentsForSimulation(mainAdmin.id, user.id);
    expect(rows).toEqual([]);
  });
});

describe("simulateDailyInterestDays", () => {
  it("rejects a sub-admin without DEVELOPER_TOOLS", async () => {
    const subAdmin = await makeSubAdmin();
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-13T00:00:00.000Z"));

    await expect(simulateDailyInterestDays(subAdmin.id, investment.id, 3)).rejects.toThrow(/forbidden/i);
  });

  it("rejects days outside [1, 30]", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-13T00:00:00.000Z"));

    await expect(simulateDailyInterestDays(mainAdmin.id, investment.id, 0)).rejects.toThrow(
      InvalidSimulationDaysError,
    );
    await expect(simulateDailyInterestDays(mainAdmin.id, investment.id, 31)).rejects.toThrow(
      InvalidSimulationDaysError,
    );
    await expect(simulateDailyInterestDays(mainAdmin.id, investment.id, 2.5)).rejects.toThrow(
      InvalidSimulationDaysError,
    );
  });

  it("throws InvestmentNotFoundError for a nonexistent id", async () => {
    const mainAdmin = await getMainAdmin();
    await expect(simulateDailyInterestDays(mainAdmin.id, "nonexistent-id", 3)).rejects.toThrow(
      InvestmentNotFoundError,
    );
  });

  it("with no prior DAILY_INTEREST entries, starts the day after the 7-day wait ends (purchasedAt + 8 days), posts one entry per non-Friday day, compounding correctly", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    // purchased 2026-08-13 (Thursday) -> start date 2026-08-21 (Friday, skipped),
    // so days=5 simulates 08-21 (Fri, skipped), 08-22 (Sat), 08-23 (Sun),
    // 08-24 (Mon), 08-25 (Tue) — 4 real accrual days out of 5 requested.
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-13T00:00:00.000Z"));

    const summary = await simulateDailyInterestDays(mainAdmin.id, investment.id, 5);

    expect(summary.daysProcessed).toBe(5);
    expect(summary.entriesPosted).toBe(4);
    expect(summary.totalCredited.isPositive()).toBe(true);
    expect(summary.simulatedFrom.toISOString().slice(0, 10)).toBe("2026-08-21");
    expect(summary.simulatedTo.toISOString().slice(0, 10)).toBe("2026-08-25");

    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceType: "investment", referenceId: investment.id, entryType: "DAILY_INTEREST", direction: "CREDIT" },
      orderBy: { createdAt: "asc" },
    });
    expect(entries).toHaveLength(4);

    const sumOfEntries = entries.reduce((sum, e) => sum.add(e.amount), new Prisma.Decimal(0));
    expect(sumOfEntries.toString()).toBe(summary.totalCredited.toString());

    // Compounding: each day's credit must be strictly larger than the
    // previous day's (same rate applied to a growing running balance).
    for (let i = 1; i < entries.length; i++) {
      expect(new Prisma.Decimal(entries[i].amount).gt(entries[i - 1].amount)).toBe(true);
    }
  });

  it("running it a second time continues from the day after the last simulated entry, instead of colliding and posting zero", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-13T00:00:00.000Z"));

    const first = await simulateDailyInterestDays(mainAdmin.id, investment.id, 3);
    const second = await simulateDailyInterestDays(mainAdmin.id, investment.id, 3);

    expect(first.entriesPosted).toBeGreaterThan(0);
    expect(second.entriesPosted).toBeGreaterThan(0);
    expect(second.totalCredited.isPositive()).toBe(true);
    expect(second.simulatedFrom.getTime()).toBeGreaterThan(first.simulatedTo.getTime());

    const entries = await prisma.ledgerEntry.count({
      where: { referenceType: "investment", referenceId: investment.id, entryType: "DAILY_INTEREST", direction: "CREDIT" },
    });
    expect(entries).toBe(first.entriesPosted + second.entriesPosted);
  });

  it("replaying accrueDailyInterestForInvestment directly against an already-simulated date is idempotent (does not double-credit)", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-13T00:00:00.000Z"));

    const first = await simulateDailyInterestDays(mainAdmin.id, investment.id, 3);
    // simulatedFrom itself (2026-08-21, Friday) is skipped, not posted — replay
    // simulatedTo (2026-08-23, Sunday) instead, which the simulation actually
    // posted a credit for, directly against the real accrual function (not
    // the simulator, which always moves forward) to prove the underlying
    // idempotency key still holds for these dates.
    const replay = await accrueDailyInterestForInvestment(investment.id, first.simulatedTo);
    expect(replay.skipped === false && replay.alreadyProcessed).toBe(true);

    const entries = await prisma.ledgerEntry.count({
      where: { referenceType: "investment", referenceId: investment.id, entryType: "DAILY_INTEREST", direction: "CREDIT" },
    });
    expect(entries).toBe(first.entriesPosted);
  });

  it("never touches any OTHER investment or user's balance", async () => {
    const mainAdmin = await getMainAdmin();
    const targetUser = await makeUser();
    const otherUser = await makeUser();
    const targetInvestment = await makeInvestment(targetUser.id, "1000", new Date("2026-08-13T00:00:00.000Z"));
    const otherInvestment = await makeInvestment(otherUser.id, "1000", new Date("2026-08-13T00:00:00.000Z"));

    await simulateDailyInterestDays(mainAdmin.id, targetInvestment.id, 3);

    const otherEntries = await prisma.ledgerEntry.count({
      where: { referenceType: "investment", referenceId: otherInvestment.id, entryType: "DAILY_INTEREST" },
    });
    expect(otherEntries).toBe(0);

    const otherWalletA = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: otherUser.id, type: "A" } },
    });
    expect(otherWalletA.balance.isZero()).toBe(true);
  });

  it("logs DAILY_INTEREST_SIMULATED to admin_actions, attributed to the acting admin and target user, including the simulated date range", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-13T00:00:00.000Z"));

    const summary = await simulateDailyInterestDays(mainAdmin.id, investment.id, 3);

    const action = await prisma.adminAction.findFirst({
      where: { adminId: mainAdmin.id, actionType: "DAILY_INTEREST_SIMULATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(action).not.toBeNull();
    expect(action!.targetUserId).toBe(user.id);
    expect(action!.reason).toContain(investment.id);
    expect(action!.reason).toContain(summary.simulatedFrom.toISOString().slice(0, 10));
    expect(action!.reason).toContain(summary.simulatedTo.toISOString().slice(0, 10));
  });
});
