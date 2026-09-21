import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { postTransaction } from "./ledger-transaction";
import { transferAtoB, transferCtoB, InsufficientWithdrawableBalanceError, AccountSuspendedError } from "./transfers";
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
    email: `transfer-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Transfer User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeInvestment(userId: string, amount: string, status: "ACTIVE" | "CAPITAL_RELEASED" = "ACTIVE") {
  const pkg = await prisma.package.create({
    data: { name: `Test-${crypto.randomUUID()}`, amount, isActive: true },
  });
  createdPackageIds.push(pkg.id);

  const purchasedAt = new Date("2026-01-01T00:00:00.000Z");
  const investment = await prisma.investment.create({
    data: {
      userId,
      packageId: pkg.id,
      amount,
      purchasedAt,
      profitStartsAt: new Date("2026-01-08T00:00:00.000Z"),
      capitalUnlocksAt: new Date("2026-07-01T00:00:00.000Z"),
      status,
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
  await prisma.walletTransfer.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("transferAtoB", () => {
  it("rejects on a non-Friday and writes nothing", async () => {
    const user = await makeUser();
    await makeInvestment(user.id, "1000");
    await fundWallet(user.id, "A", "1200"); // 1000 capital + 200 profit

    await expect(transferAtoB(user.id, "100", THURSDAY)).rejects.toThrow(NotFridayError);

    const transfers = await prisma.walletTransfer.findMany({ where: { userId: user.id } });
    expect(transfers).toHaveLength(0);
    const walletA = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "A" } } });
    expect(new Prisma.Decimal(walletA.balance).eq("1200")).toBe(true);
  });

  it("withdraws only the profit portion when capital is still locked", async () => {
    const user = await makeUser();
    await makeInvestment(user.id, "1000"); // ACTIVE -> 1000 locked capital
    await fundWallet(user.id, "A", "1200"); // balance 1200 = 1000 capital + 200 profit

    // Withdrawing the full profit (200) on a Friday should succeed.
    const result = await transferAtoB(user.id, "200", FRIDAY);
    expect(result.alreadyProcessed).toBe(false);

    const walletA = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "A" } } });
    expect(new Prisma.Decimal(walletA.balance).eq("1000")).toBe(true); // exactly the locked capital remains

    const walletB = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "B" } } });
    expect(new Prisma.Decimal(walletB.balance).eq("200")).toBe(true);
  });

  it("rejects an amount exceeding the withdrawable (non-capital) balance", async () => {
    const user = await makeUser();
    await makeInvestment(user.id, "1000");
    await fundWallet(user.id, "A", "1200"); // only 200 withdrawable

    await expect(transferAtoB(user.id, "201", FRIDAY)).rejects.toThrow(InsufficientWithdrawableBalanceError);

    const walletA = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "A" } } });
    expect(new Prisma.Decimal(walletA.balance).eq("1200")).toBe(true);
  });

  it("allows withdrawing capital that belonged to a CAPITAL_RELEASED investment (no longer locked)", async () => {
    const user = await makeUser();
    await makeInvestment(user.id, "1000", "CAPITAL_RELEASED"); // not counted as locked
    await fundWallet(user.id, "A", "1000");

    const result = await transferAtoB(user.id, "1000", FRIDAY);
    expect(result.alreadyProcessed).toBe(false);

    const walletA = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "A" } } });
    expect(new Prisma.Decimal(walletA.balance).isZero()).toBe(true);
  });

  it("blocks a suspended user", async () => {
    const user = await makeUser();
    await makeInvestment(user.id, "1000");
    await fundWallet(user.id, "A", "1200");
    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: FRIDAY } });

    await expect(transferAtoB(user.id, "100", FRIDAY)).rejects.toThrow(AccountSuspendedError);
  });
});

describe("transferCtoB", () => {
  it("withdraws the full Wallet C balance (SAVING not yet populated)", async () => {
    const user = await makeUser();
    await fundWallet(user.id, "C", "300");

    const result = await transferCtoB(user.id, "300", FRIDAY);
    expect(result.alreadyProcessed).toBe(false);

    const walletC = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "C" } } });
    expect(new Prisma.Decimal(walletC.balance).isZero()).toBe(true);
    const walletB = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "B" } } });
    expect(new Prisma.Decimal(walletB.balance).eq("300")).toBe(true);
  });

  it("succeeds on a non-Friday — C→B has no Friday restriction (only Wallet B exits do)", async () => {
    const user = await makeUser();
    await fundWallet(user.id, "C", "300");

    const result = await transferCtoB(user.id, "300", THURSDAY);
    expect(result.alreadyProcessed).toBe(false);

    const walletC = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "C" } } });
    expect(new Prisma.Decimal(walletC.balance).isZero()).toBe(true);
  });

  it("rejects an amount exceeding the Wallet C balance", async () => {
    const user = await makeUser();
    await fundWallet(user.id, "C", "300");

    await expect(transferCtoB(user.id, "301", FRIDAY)).rejects.toThrow(InsufficientWithdrawableBalanceError);
  });

  it("does not reduce the available amount by the SAVING balance (regression guard for the withdrawableC fix)", async () => {
    const user = await makeUser();
    await fundWallet(user.id, "C", "50");
    await postTransaction({
      entries: [
        { userId: user.id, wallet: "SAVING", direction: "CREDIT", amount: "30", entryType: "ADMIN_CREDIT", comment: "Test funding." },
        { userId: null, wallet: "SYSTEM_EXTERNAL", direction: "DEBIT", amount: "30", entryType: "ADMIN_CREDIT", comment: "Test funding." },
      ],
      idempotencyKey: `test-fund:SAVING:${user.id}:${crypto.randomUUID()}`,
    });

    // Previously this would have thrown InsufficientWithdrawableBalanceError
    // (available was wrongly capped at 50 - 30 = 20).
    const result = await transferCtoB(user.id, "50", THURSDAY);
    expect(result.alreadyProcessed).toBe(false);
  });
});

describe("replay safety", () => {
  it("a transfer is idempotent under its own generated key: calling postTransaction twice with the same key does not double-transfer", async () => {
    // transferAtoB itself generates a fresh key per call (by design, confirmed
    // with the user — legitimate repeat withdrawals must both succeed), so
    // replay-safety is verified at the postTransaction layer it depends on:
    // the same idempotencyKey, submitted twice, must not double-apply.
    const user = await makeUser();
    await makeInvestment(user.id, "1000");
    await fundWallet(user.id, "A", "1200");

    const idempotencyKey = `transfer:A:${user.id}:${crypto.randomUUID()}`;
    const entries = [
      { userId: user.id, wallet: "A" as const, direction: "DEBIT" as const, amount: "200", entryType: "WITHDRAWAL_OUT" as const, comment: "A→B profit withdrawal." },
      { userId: user.id, wallet: "B" as const, direction: "CREDIT" as const, amount: "200", entryType: "WITHDRAWAL_IN" as const, comment: "A→B profit withdrawal." },
    ];

    const first = await postTransaction({ entries, idempotencyKey });
    const second = await postTransaction({ entries, idempotencyKey });

    expect(first.alreadyProcessed).toBe(false);
    expect(second.alreadyProcessed).toBe(true);

    const rows = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(rows).toHaveLength(2);

    const walletA = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "A" } } });
    expect(new Prisma.Decimal(walletA.balance).eq("1000")).toBe(true); // 1200 - 200, not - 400
  });

  it("calling transferAtoB twice in immediate succession moves funds twice (each call is its own legitimate withdrawal, not a replay)", async () => {
    const user = await makeUser();
    await makeInvestment(user.id, "1000");
    await fundWallet(user.id, "A", "1400"); // 400 profit available

    await transferAtoB(user.id, "150", FRIDAY);
    await transferAtoB(user.id, "150", FRIDAY);

    const walletA = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "A" } } });
    expect(new Prisma.Decimal(walletA.balance).eq("1100")).toBe(true); // 1400 - 150 - 150

    const transfers = await prisma.walletTransfer.findMany({ where: { userId: user.id } });
    expect(transfers).toHaveLength(2);
  });
});
