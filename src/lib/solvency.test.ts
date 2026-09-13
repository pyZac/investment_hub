import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot, registerWithSponsor } from "./users";
import { adminCreditWalletB } from "./admin-credit";
import { purchasePackage } from "./investments";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";
import { hashToken } from "./token-hash";
import { requirePermission } from "./route-guard";
import { getSolvencyOverview } from "./solvency";

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
      email: `solvency-subadmin-${crypto.randomUUID()}@test.local`,
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

async function makeUser(label = "root") {
  const user = await registerAsRoot({
    email: `solvency-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Solvency Test User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeSponsoredUser(sponsorId: string, label = "sponsored") {
  const user = await registerWithSponsor(sponsorId, {
    email: `solvency-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Solvency Sponsored User",
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

async function fundWalletB(userId: string, amount: string) {
  const mainAdmin = await getMainAdmin();
  await adminCreditWalletB(mainAdmin.id, {
    userId,
    amount,
    reason: "Test funding for solvency tests.",
    idempotencyKey: `solvency-fund:${userId}:${crypto.randomUUID()}`,
  });
}

async function makePurchase(userId: string, packageAmount: string, forDate: Date) {
  const pkg = await makePackage(packageAmount);
  await fundWalletB(userId, packageAmount);
  const result = await purchasePackage(userId, {
    packageId: pkg.id,
    forDate,
    idempotencyKey: `solvency-purchase:${userId}:${crypto.randomUUID()}`,
  });
  createdInvestmentIds.push(result.investment.id);
  return result.investment;
}

afterAll(async () => {
  await prisma.bvEntry.deleteMany({ where: { sourceInvestmentId: { in: createdInvestmentIds } } });
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await prisma.savingLot.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.mrvPeriod.deleteMany({ where: { userId: { in: createdUserIds } } });
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.binaryNode.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("route-level enforcement", () => {
  it("a sub-admin without SOLVENCY_VIEW is rejected at the route level", async () => {
    const subAdmin = await makeSubAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("SOLVENCY_VIEW", now, token)).rejects.toMatchObject({ status: 403 });
  });

  it("a sub-admin with SOLVENCY_VIEW is allowed at the route level", async () => {
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "SOLVENCY_VIEW" },
    });
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolved = await requirePermission("SOLVENCY_VIEW", now, token);
    expect(resolved.id).toBe(subAdmin.id);
  });

  it("the main admin reaches it with zero explicit grants", async () => {
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(mainAdmin.id, now);

    const resolved = await requirePermission("SOLVENCY_VIEW", now, token);
    expect(resolved.id).toBe(mainAdmin.id);
  });
});

describe("getSolvencyOverview", () => {
  it("rejects a caller without SOLVENCY_VIEW", async () => {
    const subAdmin = await makeSubAdmin();
    await expect(getSolvencyOverview(subAdmin.id, new Date())).rejects.toThrow(/forbidden/i);
  });

  it("total credit issued matches the sum of all ADMIN_CREDIT CREDIT-side ledger entries, as a delta from a known real issuance", async () => {
    const mainAdmin = await getMainAdmin();
    const forDate = new Date();

    const before = await getSolvencyOverview(mainAdmin.id, forDate);

    const user = await makeUser("credit-delta");
    await fundWalletB(user.id, "12345");

    const after = await getSolvencyOverview(mainAdmin.id, forDate);

    const delta = after.totalCreditIssued.sub(before.totalCreditIssued);
    expect(delta.eq("12345")).toBe(true);

    // Independent cross-check: sum the real ADMIN_CREDIT CREDIT-side rows
    // directly, not via getSolvencyOverview itself, to prove the function's
    // own query is correct rather than just internally self-consistent.
    const directSum = await prisma.ledgerEntry.aggregate({
      where: { entryType: "ADMIN_CREDIT", direction: "CREDIT" },
      _sum: { amount: true },
    });
    expect(new Prisma.Decimal(directSum._sum.amount!).eq(after.totalCreditIssued)).toBe(true);
  });

  it("total liabilities matches the sum of all current wallet balances, as a delta from a known real purchase", async () => {
    const mainAdmin = await getMainAdmin();
    const forDate = new Date();

    const before = await getSolvencyOverview(mainAdmin.id, forDate);

    // A sponsored purchase touches every non-SYSTEM_EXTERNAL wallet type
    // at once: buyer's Wallet A (principal), sponsor's Wallet C (Direct
    // Commission), sponsor's Wallet SAVING (the locked 3% split) — Wallet
    // B nets to zero (funded then spent). Deliberately exercises all of
    // them in one purchase, since Investment.amount and SavingLot.amount
    // are BOTH metadata alongside money already inside a wallet balance
    // (see solvency.ts's own doc comment) — a formula that double-counted
    // either would fail this exact delta check.
    const sponsor = await makeUser("liabilities-sponsor");
    const buyer = await makeSponsoredUser(sponsor.id, "liabilities-buyer");
    const purchaseDate = new Date("2026-09-01T10:00:00.000Z");
    const investment = await makePurchase(buyer.id, "10000", purchaseDate);

    const after = await getSolvencyOverview(mainAdmin.id, forDate);

    const delta = after.totalLiabilities.sub(before.totalLiabilities);
    const expectedDelta = new Prisma.Decimal("10000").add("500").add("300"); // A + C + SAVING
    expect(delta.eq(expectedDelta)).toBe(true);

    // Independent cross-check against the real rows directly, plus proof
    // the breakdown's own components sum to the same total.
    const [walletA, walletC, walletSaving] = await Promise.all([
      prisma.walletAccount.aggregate({ where: { type: "A" }, _sum: { balance: true } }),
      prisma.walletAccount.aggregate({ where: { type: "C" }, _sum: { balance: true } }),
      prisma.walletAccount.aggregate({ where: { type: "SAVING" }, _sum: { balance: true } }),
    ]);
    expect(new Prisma.Decimal(walletA._sum.balance!).eq(after.liabilitiesBreakdown.walletA)).toBe(true);
    expect(new Prisma.Decimal(walletC._sum.balance!).eq(after.liabilitiesBreakdown.walletC)).toBe(true);
    expect(new Prisma.Decimal(walletSaving._sum.balance!).eq(after.liabilitiesBreakdown.walletSaving)).toBe(true);

    const breakdownSum = after.liabilitiesBreakdown.walletA
      .add(after.liabilitiesBreakdown.walletB)
      .add(after.liabilitiesBreakdown.walletC)
      .add(after.liabilitiesBreakdown.walletSaving);
    expect(breakdownSum.eq(after.totalLiabilities)).toBe(true);

    // SavingLot/Investment rows exist as metadata but are NOT counted
    // separately — confirms the double-counting bug this test caught
    // during development doesn't silently regress.
    const savingLot = await prisma.savingLot.findFirstOrThrow({ where: { userId: sponsor.id } });
    expect(new Prisma.Decimal(savingLot.amount).eq("300")).toBe(true);
    const lockedInvestment = await prisma.investment.findUniqueOrThrow({ where: { id: investment.id } });
    expect(lockedInvestment.capitalReleasedAt).toBeNull();
  });

  it("computes a solvency ratio as totalCreditIssued / totalLiabilities", async () => {
    const mainAdmin = await getMainAdmin();
    const overview = await getSolvencyOverview(mainAdmin.id, new Date());

    if (overview.totalLiabilities.isZero()) {
      expect(overview.solvencyRatio).toBeNull();
    } else {
      const expectedRatio = overview.totalCreditIssued.div(overview.totalLiabilities);
      expect(overview.solvencyRatio!.eq(expectedRatio)).toBe(true);
    }
  });

  it("the 30-day projection compounds current Wallet A total at today's real dailyRate", async () => {
    const mainAdmin = await getMainAdmin();
    const forDate = new Date("2026-09-15T10:00:00.000Z");

    const overview = await getSolvencyOverview(mainAdmin.id, forDate);

    const walletATotal = await prisma.walletAccount.aggregate({
      where: { type: "A" },
      _sum: { balance: true },
    });
    const currentTotal = new Prisma.Decimal(walletATotal._sum.balance ?? 0);

    // Cross-check using the real dailyRate function directly.
    const { dailyRate } = await import("./interest-rate");
    const rate = await dailyRate(forDate);
    const expectedProjection = currentTotal.mul(new Prisma.Decimal(1).add(rate).pow(30));

    expect(overview.projectedLiabilities30d.eq(expectedProjection)).toBe(true);
  });
});
