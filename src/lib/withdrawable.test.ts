import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { postTransaction } from "./ledger-transaction";
import { withdrawableC, withdrawableProfitA } from "./withdrawable";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeUser() {
  const user = await registerAsRoot({
    email: `withdrawable-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Withdrawable Test User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

/** Funds a user's wallet directly via a balanced ledger entry against SYSTEM_EXTERNAL. */
async function fundWallet(userId: string, wallet: "A" | "B" | "C" | "SAVING", amount: string) {
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
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("withdrawableC", () => {
  it("regression: SAVING balance does NOT reduce Wallet C's available amount (bug: C=$50, SAVING=$30 wrongly showed $20)", async () => {
    const user = await makeUser();
    await fundWallet(user.id, "C", "50");
    await fundWallet(user.id, "SAVING", "30");

    const available = await withdrawableC(user.id);
    expect(available.eq("50")).toBe(true);
  });

  it("returns the full C balance when SAVING is empty", async () => {
    const user = await makeUser();
    await fundWallet(user.id, "C", "75");

    const available = await withdrawableC(user.id);
    expect(available.eq("75")).toBe(true);
  });

  it("returns zero when C is empty, regardless of SAVING balance", async () => {
    const user = await makeUser();
    await fundWallet(user.id, "SAVING", "100");

    const available = await withdrawableC(user.id);
    expect(available.isZero()).toBe(true);
  });
});

describe("withdrawableProfitA (unaffected by the C fix — regression guard)", () => {
  it("still excludes locked capital from Wallet A's withdrawable amount", async () => {
    const user = await registerAsRoot({
      email: `withdrawable-a-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Withdrawable A User",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);

    const pkg = await prisma.package.create({ data: { name: `Test-${crypto.randomUUID()}`, amount: "1000", isActive: true } });
    await prisma.investment.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        amount: "1000",
        purchasedAt: new Date("2026-01-01T00:00:00.000Z"),
        profitStartsAt: new Date("2026-01-08T00:00:00.000Z"),
        capitalUnlocksAt: new Date("2026-07-01T00:00:00.000Z"),
        status: "ACTIVE",
        referenceId: `seed-purchase:${crypto.randomUUID()}`,
      },
    });
    await fundWallet(user.id, "A", "1200"); // 1000 locked capital + 200 profit

    const available = await withdrawableProfitA(user.id);
    expect(available.eq("200")).toBe(true);

    await prisma.investment.deleteMany({ where: { userId: user.id } });
    await prisma.package.delete({ where: { id: pkg.id } });
  });
});
