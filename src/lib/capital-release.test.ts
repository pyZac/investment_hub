import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { postTransaction } from "./ledger-transaction";
import {
  releaseCapital,
  CapitalStillLockedError,
  CapitalAlreadyReleasedError,
  InvestmentNotOwnedError,
} from "./capital-release";
import { accrueDailyInterestForInvestment } from "./daily-interest";
import { NotFridayError } from "./withdrawal-guard";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
const createdInvestmentIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

// 2026-08-21 is a Friday. Noon UTC is also Friday in Asia/Dubai (UTC+4).
const FRIDAY = new Date("2026-08-21T12:00:00.000Z");
// 2026-08-20 is a Thursday.
const THURSDAY = new Date("2026-08-20T12:00:00.000Z");

async function makeUser() {
  const user = await registerAsRoot({
    email: `caprelease-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Capital Release User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeInvestment(userId: string, amount: string, capitalUnlocksAt: Date) {
  const pkg = await prisma.package.create({
    data: { name: `Test-${crypto.randomUUID()}`, amount, isActive: true },
  });
  createdPackageIds.push(pkg.id);

  const investment = await prisma.investment.create({
    data: {
      userId,
      packageId: pkg.id,
      amount,
      purchasedAt: new Date("2026-01-01T00:00:00.000Z"),
      profitStartsAt: new Date("2026-01-08T00:00:00.000Z"),
      capitalUnlocksAt,
      referenceId: `seed-purchase:${crypto.randomUUID()}`,
    },
  });
  createdInvestmentIds.push(investment.id);
  return investment;
}

/** Funds a user's wallet directly via a balanced ledger entry against SYSTEM_EXTERNAL, mirroring how real credits/interest arrive. */
async function fundWallet(userId: string, wallet: "A" | "B" | "C", amount: string) {
  const idempotencyKey = `test-fund:${wallet}:${userId}:${crypto.randomUUID()}`;
  await postTransaction({
    entries: [
      { userId, wallet, direction: "CREDIT", amount, entryType: "ADMIN_CREDIT", comment: "Test funding." },
      { userId: null, wallet: "SYSTEM_EXTERNAL", direction: "DEBIT", amount, entryType: "ADMIN_CREDIT", comment: "Test funding." },
    ],
    idempotencyKey,
  });
}

afterAll(async () => {
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("releaseCapital", () => {
  it("rejects release attempted before the 6-month lock expires", async () => {
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", new Date("2027-02-16T09:00:00.000Z"));
    await fundWallet(user.id, "A", "1000");

    await expect(releaseCapital(user.id, investment.id, FRIDAY)).rejects.toThrow(CapitalStillLockedError);

    const unchanged = await prisma.investment.findUniqueOrThrow({ where: { id: investment.id } });
    expect(unchanged.status).toBe("ACTIVE");
    expect(unchanged.capitalReleasedAt).toBeNull();
    const walletA = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "A" } } });
    expect(new Prisma.Decimal(walletA.balance).eq("1000")).toBe(true);
  });

  it("succeeds exactly at the unlock date and moves only the principal, not accrued profit in the same A balance", async () => {
    const user = await makeUser();
    // Unlock date is exactly FRIDAY.
    const investment = await makeInvestment(user.id, "1000", FRIDAY);
    // A balance = 1000 principal + 150 profit (e.g. already-accrued interest), same wallet.
    await fundWallet(user.id, "A", "1150");

    const { investment: updated } = await releaseCapital(user.id, investment.id, FRIDAY);

    expect(updated.status).toBe("CAPITAL_RELEASED");
    expect(updated.capitalReleasedAt?.toISOString()).toBe(FRIDAY.toISOString());

    // Only the 1000 principal moved; the 150 profit remains in A.
    const walletA = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "A" } } });
    expect(new Prisma.Decimal(walletA.balance).eq("150")).toBe(true);

    const walletB = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "B" } } });
    expect(new Prisma.Decimal(walletB.balance).eq("1000")).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceType: "investment", referenceId: investment.id, entryType: "CAPITAL_RELEASE" },
    });
    expect(entries).toHaveLength(2);
    const debit = entries.find((e) => e.direction === "DEBIT")!;
    const credit = entries.find((e) => e.direction === "CREDIT")!;
    expect(debit.wallet).toBe("A");
    expect(new Prisma.Decimal(debit.amount).eq("1000")).toBe(true);
    expect(credit.wallet).toBe("B");
    expect(new Prisma.Decimal(credit.amount).eq("1000")).toBe(true);
  });

  it("succeeds after the unlock date has passed", async () => {
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "500", new Date("2026-08-01T00:00:00.000Z"));
    await fundWallet(user.id, "A", "500");

    const { investment: updated } = await releaseCapital(user.id, investment.id, FRIDAY);
    expect(updated.status).toBe("CAPITAL_RELEASED");
  });

  it("a released investment no longer accrues interest on the next daily job call", async () => {
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", FRIDAY);
    await fundWallet(user.id, "A", "1000");

    await releaseCapital(user.id, investment.id, FRIDAY);

    // A later, non-Friday date, well past profitStartsAt — would normally accrue.
    const laterDate = new Date("2026-08-24T06:00:00.000Z");
    const result = await accrueDailyInterestForInvestment(investment.id, laterDate);

    expect(result.skipped).toBe(true);
    if (!result.skipped) throw new Error("unreachable");
    expect(result.reason).toBe("capital_released");

    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceType: "investment", referenceId: investment.id, entryType: "DAILY_INTEREST" },
    });
    expect(entries).toHaveLength(0);
  });

  it("rejects a non-Friday release attempt", async () => {
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-01T00:00:00.000Z"));
    await fundWallet(user.id, "A", "1000");

    await expect(releaseCapital(user.id, investment.id, THURSDAY)).rejects.toThrow(NotFridayError);

    const unchanged = await prisma.investment.findUniqueOrThrow({ where: { id: investment.id } });
    expect(unchanged.status).toBe("ACTIVE");
  });

  it("rejects releasing an already-released investment", async () => {
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", FRIDAY);
    await fundWallet(user.id, "A", "1000");

    await releaseCapital(user.id, investment.id, FRIDAY);

    await expect(releaseCapital(user.id, investment.id, FRIDAY)).rejects.toThrow(CapitalAlreadyReleasedError);

    // Still only one set of CAPITAL_RELEASE entries — no double-release.
    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceType: "investment", referenceId: investment.id, entryType: "CAPITAL_RELEASE" },
    });
    expect(entries).toHaveLength(2);
  });

  it("rejects releasing another user's investment", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const investment = await makeInvestment(owner.id, "1000", new Date("2026-08-01T00:00:00.000Z"));
    await fundWallet(owner.id, "A", "1000");

    await expect(releaseCapital(other.id, investment.id, FRIDAY)).rejects.toThrow(InvestmentNotOwnedError);

    const unchanged = await prisma.investment.findUniqueOrThrow({ where: { id: investment.id } });
    expect(unchanged.status).toBe("ACTIVE");
    const ownerWalletA = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: owner.id, type: "A" } } });
    expect(new Prisma.Decimal(ownerWalletA.balance).eq("1000")).toBe(true);
  });
});
