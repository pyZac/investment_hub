import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { postTransaction } from "./ledger-transaction";
import {
  transferBetweenUsers,
  searchTransferRecipients,
  BelowMinimumTransferError,
  InsufficientWalletBBalanceError,
  RecipientNotFoundError,
  SelfTransferError,
} from "./user-transfer";
import { AccountSuspendedError } from "./transfers";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeUser(name = "Transfer User") {
  const user = await registerAsRoot({
    email: `user-transfer-${randomUUID()}@test.local`,
    password: "password123",
    name,
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

/** Funds a user's Wallet B directly via a balanced ledger entry against SYSTEM_EXTERNAL. */
async function fundWalletB(userId: string, amount: string) {
  const idempotencyKey = `test-fund:B:${userId}:${randomUUID()}`;
  await postTransaction({
    entries: [
      { userId, wallet: "B", direction: "CREDIT", amount, entryType: "ADMIN_CREDIT", comment: "Test funding." },
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

describe("transferBetweenUsers", () => {
  it("rejects a transfer below the minimum", async () => {
    const sender = await makeUser("Sender A");
    const recipient = await makeUser("Recipient A");
    await fundWalletB(sender.id, "1000");

    await expect(
      transferBetweenUsers(sender.id, recipient.id, "49.99999999", `user_transfer:${sender.id}:${randomUUID()}`),
    ).rejects.toThrow(BelowMinimumTransferError);

    const senderB = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: sender.id, type: "B" } } });
    expect(new Prisma.Decimal(senderB.balance).eq("1000")).toBe(true);
  });

  it("rejects a transfer exceeding the sender's Wallet B balance", async () => {
    const sender = await makeUser("Sender B");
    const recipient = await makeUser("Recipient B");
    await fundWalletB(sender.id, "100");

    await expect(
      transferBetweenUsers(sender.id, recipient.id, "100.00000001", `user_transfer:${sender.id}:${randomUUID()}`),
    ).rejects.toThrow(InsufficientWalletBBalanceError);
  });

  it("rejects a transfer to a suspended recipient", async () => {
    const sender = await makeUser("Sender C");
    const recipient = await makeUser("Recipient C");
    await fundWalletB(sender.id, "1000");
    await prisma.user.update({ where: { id: recipient.id }, data: { suspendedAt: new Date() } });

    await expect(
      transferBetweenUsers(sender.id, recipient.id, "100", `user_transfer:${sender.id}:${randomUUID()}`),
    ).rejects.toThrow(RecipientNotFoundError);

    const senderB = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: sender.id, type: "B" } } });
    expect(new Prisma.Decimal(senderB.balance).eq("1000")).toBe(true);
  });

  it("rejects a transfer from a suspended sender", async () => {
    const sender = await makeUser("Sender D");
    const recipient = await makeUser("Recipient D");
    await fundWalletB(sender.id, "1000");
    await prisma.user.update({ where: { id: sender.id }, data: { suspendedAt: new Date() } });

    await expect(
      transferBetweenUsers(sender.id, recipient.id, "100", `user_transfer:${sender.id}:${randomUUID()}`),
    ).rejects.toThrow(AccountSuspendedError);
  });

  it("rejects a self-transfer", async () => {
    const user = await makeUser("Self Transfer User");
    await fundWalletB(user.id, "1000");

    await expect(
      transferBetweenUsers(user.id, user.id, "100", `user_transfer:${user.id}:${randomUUID()}`),
    ).rejects.toThrow(SelfTransferError);
  });

  it("rejects a transfer to a non-existent recipient", async () => {
    const sender = await makeUser("Sender E");
    await fundWalletB(sender.id, "1000");

    await expect(
      transferBetweenUsers(sender.id, "nonexistent-user-id", "100", `user_transfer:${sender.id}:${randomUUID()}`),
    ).rejects.toThrow(RecipientNotFoundError);
  });

  it("posts a balanced pair of ledger entries and updates both Wallet B balances correctly", async () => {
    const sender = await makeUser("Sender F");
    const recipient = await makeUser("Recipient F");
    await fundWalletB(sender.id, "1000");
    await fundWalletB(recipient.id, "50");

    const idempotencyKey = `user_transfer:${sender.id}:${randomUUID()}`;
    const result = await transferBetweenUsers(sender.id, recipient.id, "123.45678901", idempotencyKey);
    expect(result.alreadyProcessed).toBe(false);

    const senderB = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: sender.id, type: "B" } } });
    const recipientB = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: recipient.id, type: "B" } } });
    expect(new Prisma.Decimal(senderB.balance).eq("876.54321099")).toBe(true);
    expect(new Prisma.Decimal(recipientB.balance).eq("173.45678901")).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(entries).toHaveLength(2);

    const senderEntry = entries.find((e) => e.userId === sender.id)!;
    const recipientEntry = entries.find((e) => e.userId === recipient.id)!;

    expect(senderEntry.entryType).toBe("USER_TRANSFER_SENT");
    expect(senderEntry.direction).toBe("DEBIT");
    expect(senderEntry.wallet).toBe("B");
    expect(new Prisma.Decimal(senderEntry.amount).eq("123.45678901")).toBe(true);
    expect(senderEntry.comment).toContain(recipient.name);

    expect(recipientEntry.entryType).toBe("USER_TRANSFER_RECEIVED");
    expect(recipientEntry.direction).toBe("CREDIT");
    expect(recipientEntry.wallet).toBe("B");
    expect(new Prisma.Decimal(recipientEntry.amount).eq("123.45678901")).toBe(true);
    expect(recipientEntry.comment).toContain(sender.name);

    // Debits equal credits (double-entry balance).
    const totalDebits = entries.filter((e) => e.direction === "DEBIT").reduce((sum, e) => sum.add(e.amount), new Prisma.Decimal(0));
    const totalCredits = entries.filter((e) => e.direction === "CREDIT").reduce((sum, e) => sum.add(e.amount), new Prisma.Decimal(0));
    expect(totalDebits.eq(totalCredits)).toBe(true);
  });

  it("is idempotent: replaying the same idempotency key does not double-transfer", async () => {
    const sender = await makeUser("Sender G");
    const recipient = await makeUser("Recipient G");
    await fundWalletB(sender.id, "1000");

    const idempotencyKey = `user_transfer:${sender.id}:${randomUUID()}`;
    const first = await transferBetweenUsers(sender.id, recipient.id, "200", idempotencyKey);
    const second = await transferBetweenUsers(sender.id, recipient.id, "200", idempotencyKey);

    expect(first.alreadyProcessed).toBe(false);
    expect(second.alreadyProcessed).toBe(true);

    const senderB = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: sender.id, type: "B" } } });
    const recipientB = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: recipient.id, type: "B" } } });
    expect(new Prisma.Decimal(senderB.balance).eq("800")).toBe(true); // 1000 - 200, not - 400
    expect(new Prisma.Decimal(recipientB.balance).eq("200")).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(entries).toHaveLength(2);
  });
});

describe("searchTransferRecipients", () => {
  it("excludes the searching user themselves", async () => {
    const user = await makeUser("Searcher Self-Exclude");
    const results = await searchTransferRecipients(user.id, user.name);
    expect(results.find((r) => r.id === user.id)).toBeUndefined();
  });

  it("excludes suspended users", async () => {
    const searcher = await makeUser("Searcher");
    const suspended = await makeUser(`Suspended-${randomUUID()}`);
    await prisma.user.update({ where: { id: suspended.id }, data: { suspendedAt: new Date() } });

    const results = await searchTransferRecipients(searcher.id, suspended.name);
    expect(results.find((r) => r.id === suspended.id)).toBeUndefined();
  });

  it("finds a match by name or email", async () => {
    const searcher = await makeUser("Searcher 2");
    const target = await makeUser(`FindMe-${randomUUID()}`);

    const byName = await searchTransferRecipients(searcher.id, target.name);
    expect(byName.some((r) => r.id === target.id)).toBe(true);

    const byEmail = await searchTransferRecipients(searcher.id, target.email);
    expect(byEmail.some((r) => r.id === target.id)).toBe(true);
  });

  it("excludes ADMIN-role users, even when their name/email matches the query", async () => {
    const searcher = await makeUser("Searcher Admin-Exclude");
    const admin = await prisma.user.create({
      data: {
        email: `admin-exclude-${randomUUID()}@test.local`,
        passwordHash: "x",
        name: `AdminExclude-${randomUUID()}`,
        role: "ADMIN",
      },
    });
    createdUserIds.push(admin.id);

    const results = await searchTransferRecipients(searcher.id, admin.name);
    expect(results.find((r) => r.id === admin.id)).toBeUndefined();
  });

  it("excludes the real main admin account specifically", async () => {
    const searcher = await makeUser("Searcher Main-Admin-Exclude");
    const mainAdmin = await prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });

    const results = await searchTransferRecipients(searcher.id, mainAdmin.name);
    expect(results.find((r) => r.id === mainAdmin.id)).toBeUndefined();

    const byEmail = await searchTransferRecipients(searcher.id, mainAdmin.email);
    expect(byEmail.find((r) => r.id === mainAdmin.id)).toBeUndefined();
  });

  it("returns an empty array for a blank query", async () => {
    const searcher = await makeUser("Searcher 3");
    const results = await searchTransferRecipients(searcher.id, "   ");
    expect(results).toEqual([]);
  });
});
