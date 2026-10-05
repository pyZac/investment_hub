import { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";
import { getInvestmentProfitBreakdownForUser } from "./investments";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
const createdInvestmentIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeUser(prefix: string) {
  const user = await registerAsRoot({
    email: `${prefix}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Profit Breakdown User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makePackage(name: string, amount: string) {
  const pkg = await prisma.package.create({ data: { name, amount, isActive: true } });
  createdPackageIds.push(pkg.id);
  return pkg;
}

async function makeInvestment(userId: string, packageId: string, packageAmount: string, purchasedAt: Date) {
  const profitStartsAt = new Date(purchasedAt);
  profitStartsAt.setUTCDate(profitStartsAt.getUTCDate() + 7);
  const capitalUnlocksAt = new Date(purchasedAt);
  capitalUnlocksAt.setUTCMonth(capitalUnlocksAt.getUTCMonth() + 6);

  const investment = await prisma.investment.create({
    data: {
      userId,
      packageId,
      amount: packageAmount,
      purchasedAt,
      profitStartsAt,
      capitalUnlocksAt,
      referenceId: `profit-breakdown-seed:${crypto.randomUUID()}`,
    },
  });
  createdInvestmentIds.push(investment.id);
  return investment;
}

/**
 * Writes a DAILY_INTEREST CREDIT row directly (bypassing
 * accrueDailyInterestForInvestment/postTransaction) with the exact
 * idempotencyKey format the real engine produces
 * (`daily_interest:{userId}:{investmentId}:{YYYY-MM-DD}`) — this is the
 * stable, relied-upon contract `getInvestmentProfitBreakdownForUser` itself
 * depends on to find reversals, so tests must use the real format too, not
 * an arbitrary key.
 */
async function seedDailyInterestCredit(
  userId: string,
  investmentId: string,
  amount: string,
  createdAt: Date,
  dateKey: string,
) {
  await prisma.ledgerEntry.create({
    data: {
      userId,
      wallet: "A",
      direction: "CREDIT",
      amount: new Prisma.Decimal(amount),
      entryType: "DAILY_INTEREST",
      referenceType: "investment",
      referenceId: investmentId,
      comment: "Test daily interest credit.",
      idempotencyKey: `daily_interest:${userId}:${investmentId}:${dateKey}`,
      createdAt,
    },
  });
}

/**
 * Writes a reversal row in the exact shape `reverseLedgerTransaction`
 * produces for a DAILY_INTEREST credit: entryType ADMIN_ADJUSTMENT,
 * referenceType "manual_adjustment", referenceId = the ORIGINAL
 * idempotencyKey, direction DEBIT (opposite of the original CREDIT).
 */
async function seedReversal(userId: string, investmentId: string, amount: string, dateKey: string, createdAt: Date) {
  const originalKey = `daily_interest:${userId}:${investmentId}:${dateKey}`;
  await prisma.ledgerEntry.create({
    data: {
      userId,
      wallet: "A",
      direction: "DEBIT",
      amount: new Prisma.Decimal(amount),
      entryType: "ADMIN_ADJUSTMENT",
      referenceType: "manual_adjustment",
      referenceId: originalKey,
      comment: "Test reversal.",
      idempotencyKey: `manual_adjustment:${originalKey}`,
      createdAt,
    },
  });
}

afterAll(async () => {
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("getInvestmentProfitBreakdownForUser", () => {
  it("returns an empty array for a user with no active investments", async () => {
    const user = await makeUser("breakdown-empty");
    const rows = await getInvestmentProfitBreakdownForUser(user.id, new Date());
    expect(rows).toEqual([]);
  });

  it("includes package name, amount, and purchase date for an active investment with no accrual yet", async () => {
    const user = await makeUser("breakdown-basic");
    const pkg = await makePackage(`BreakdownPkg-${crypto.randomUUID()}`, "1000");
    const purchasedAt = new Date("2026-06-01T08:00:00.000Z");
    const investment = await makeInvestment(user.id, pkg.id, "1000", purchasedAt);

    const rows = await getInvestmentProfitBreakdownForUser(user.id, new Date("2026-06-15T08:00:00.000Z"));

    expect(rows).toHaveLength(1);
    expect(rows[0].investmentId).toBe(investment.id);
    expect(rows[0].packageName).toBe(pkg.name);
    expect(new Prisma.Decimal(rows[0].amount).eq("1000")).toBe(true);
    expect(rows[0].purchasedAt.toISOString()).toBe(purchasedAt.toISOString());
    expect(rows[0].todayProfit.isZero()).toBe(true);
    expect(rows[0].totalProfit.isZero()).toBe(true);
  });

  it("excludes a CAPITAL_RELEASED investment", async () => {
    const user = await makeUser("breakdown-released");
    const pkg = await makePackage(`BreakdownPkg-${crypto.randomUUID()}`, "1000");
    const investment = await makeInvestment(user.id, pkg.id, "1000", new Date("2026-06-01T08:00:00.000Z"));
    await prisma.investment.update({
      where: { id: investment.id },
      data: { status: "CAPITAL_RELEASED", capitalReleasedAt: new Date("2026-06-10T00:00:00.000Z") },
    });

    const rows = await getInvestmentProfitBreakdownForUser(user.id, new Date("2026-06-15T08:00:00.000Z"));
    expect(rows).toEqual([]);
  });

  it("todayProfit sums only CREDIT entries whose createdAt falls in the Dubai business day containing forDate", async () => {
    const user = await makeUser("breakdown-today");
    const pkg = await makePackage(`BreakdownPkg-${crypto.randomUUID()}`, "1000");
    const investment = await makeInvestment(user.id, pkg.id, "1000", new Date("2026-06-01T08:00:00.000Z"));

    // Dubai day boundary: 2026-06-10 00:00 Dubai = 2026-06-09T20:00:00.000Z.
    // "Yesterday" (Dubai) credit, just before the boundary.
    await seedDailyInterestCredit(user.id, investment.id, "10", new Date("2026-06-09T19:00:00.000Z"), "2026-06-09");
    // "Today" (Dubai) credit, just after the boundary — near-midnight edge,
    // per the standing lesson that boundary-adjacent fixtures catch
    // UTC-vs-Dubai mismatches that noon-aligned fixtures hide.
    await seedDailyInterestCredit(user.id, investment.id, "25", new Date("2026-06-09T21:00:00.000Z"), "2026-06-10");

    const forDate = new Date("2026-06-10T08:00:00.000Z"); // noon Dubai, 2026-06-10
    const rows = await getInvestmentProfitBreakdownForUser(user.id, forDate);

    expect(rows).toHaveLength(1);
    expect(rows[0].todayProfit.eq("25")).toBe(true); // excludes the "10" from the prior Dubai day
    expect(rows[0].totalProfit.eq("35")).toBe(true); // 10 + 25, no reversals
  });

  it("totalProfit subtracts a reversed DAILY_INTEREST credit, even though the reversal shares no referenceType/referenceId with the original", async () => {
    const user = await makeUser("breakdown-reversed");
    const pkg = await makePackage(`BreakdownPkg-${crypto.randomUUID()}`, "1000");
    const investment = await makeInvestment(user.id, pkg.id, "1000", new Date("2026-06-01T08:00:00.000Z"));

    await seedDailyInterestCredit(user.id, investment.id, "50", new Date("2026-06-08T08:00:00.000Z"), "2026-06-08");
    await seedDailyInterestCredit(user.id, investment.id, "60", new Date("2026-06-09T08:00:00.000Z"), "2026-06-09");
    // Reverse only the 2026-06-08 credit.
    await seedReversal(user.id, investment.id, "50", "2026-06-08", new Date("2026-06-20T08:00:00.000Z"));

    const rows = await getInvestmentProfitBreakdownForUser(user.id, new Date("2026-06-25T08:00:00.000Z"));

    expect(rows).toHaveLength(1);
    // 50 + 60 credited, 50 reversed -> 60 net.
    expect(rows[0].totalProfit.eq("60")).toBe(true);
  });

  it("never includes another user's investments or ledger entries", async () => {
    const targetUser = await makeUser("breakdown-target");
    const otherUser = await makeUser("breakdown-other");
    const pkg = await makePackage(`BreakdownPkg-${crypto.randomUUID()}`, "1000");
    const targetInvestment = await makeInvestment(targetUser.id, pkg.id, "1000", new Date("2026-06-01T08:00:00.000Z"));
    const otherInvestment = await makeInvestment(otherUser.id, pkg.id, "1000", new Date("2026-06-01T08:00:00.000Z"));

    await seedDailyInterestCredit(targetUser.id, targetInvestment.id, "10", new Date("2026-06-10T08:00:00.000Z"), "2026-06-10");
    await seedDailyInterestCredit(otherUser.id, otherInvestment.id, "999", new Date("2026-06-10T08:00:00.000Z"), "2026-06-10");

    const rows = await getInvestmentProfitBreakdownForUser(targetUser.id, new Date("2026-06-10T08:00:00.000Z"));

    expect(rows).toHaveLength(1);
    expect(rows[0].investmentId).toBe(targetInvestment.id);
    expect(rows[0].totalProfit.eq("10")).toBe(true);
  });

  it("returns one row per active investment when a user has multiple, each with its own independent profit figures", async () => {
    const user = await makeUser("breakdown-multi");
    const pkgSmall = await makePackage(`BreakdownSmall-${crypto.randomUUID()}`, "500");
    const pkgLarge = await makePackage(`BreakdownLarge-${crypto.randomUUID()}`, "2000");
    const investmentSmall = await makeInvestment(user.id, pkgSmall.id, "500", new Date("2026-06-01T08:00:00.000Z"));
    const investmentLarge = await makeInvestment(user.id, pkgLarge.id, "2000", new Date("2026-06-02T08:00:00.000Z"));

    await seedDailyInterestCredit(user.id, investmentSmall.id, "5", new Date("2026-06-10T08:00:00.000Z"), "2026-06-10");
    await seedDailyInterestCredit(user.id, investmentLarge.id, "20", new Date("2026-06-10T08:00:00.000Z"), "2026-06-10");

    const rows = await getInvestmentProfitBreakdownForUser(user.id, new Date("2026-06-10T08:00:00.000Z"));

    expect(rows).toHaveLength(2);
    const small = rows.find((r) => r.investmentId === investmentSmall.id)!;
    const large = rows.find((r) => r.investmentId === investmentLarge.id)!;
    expect(small.totalProfit.eq("5")).toBe(true);
    expect(large.totalProfit.eq("20")).toBe(true);
  });
});
