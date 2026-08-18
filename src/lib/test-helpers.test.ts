import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { postTransaction } from "./ledger-transaction";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeUser() {
  const user = await registerAsRoot({
    email: `test-helpers-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Test Helpers User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("cleanupLedgerEntriesForUsers", () => {
  it("deletes both the real-user-side row and the paired SYSTEM_EXTERNAL row", async () => {
    const user = await makeUser();
    const idempotencyKey = `test-helpers-pair:${user.id}:${crypto.randomUUID()}`;

    await postTransaction({
      entries: [
        { userId: user.id, wallet: "B", direction: "CREDIT", amount: "100", entryType: "ADMIN_CREDIT", comment: "Helper test." },
        { userId: null, wallet: "SYSTEM_EXTERNAL", direction: "DEBIT", amount: "100", entryType: "ADMIN_CREDIT", comment: "Helper test." },
      ],
      idempotencyKey,
    });

    const beforeCleanup = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(beforeCleanup).toHaveLength(2);

    await cleanupLedgerEntriesForUsers([user.id]);

    const afterCleanup = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(afterCleanup).toHaveLength(0);
  });

  it("leaves other users' ledger entries untouched", async () => {
    const targetUser = await makeUser();
    const otherUser = await makeUser();

    const targetKey = `test-helpers-target:${targetUser.id}:${crypto.randomUUID()}`;
    const otherKey = `test-helpers-other:${otherUser.id}:${crypto.randomUUID()}`;

    await postTransaction({
      entries: [
        { userId: targetUser.id, wallet: "B", direction: "CREDIT", amount: "50", entryType: "ADMIN_CREDIT", comment: "Target." },
        { userId: null, wallet: "SYSTEM_EXTERNAL", direction: "DEBIT", amount: "50", entryType: "ADMIN_CREDIT", comment: "Target." },
      ],
      idempotencyKey: targetKey,
    });
    await postTransaction({
      entries: [
        { userId: otherUser.id, wallet: "B", direction: "CREDIT", amount: "75", entryType: "ADMIN_CREDIT", comment: "Other." },
        { userId: null, wallet: "SYSTEM_EXTERNAL", direction: "DEBIT", amount: "75", entryType: "ADMIN_CREDIT", comment: "Other." },
      ],
      idempotencyKey: otherKey,
    });

    await cleanupLedgerEntriesForUsers([targetUser.id]);

    const targetEntries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey: targetKey } });
    const otherEntries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey: otherKey } });
    expect(targetEntries).toHaveLength(0);
    expect(otherEntries).toHaveLength(2);

    // Manual cleanup for the row this test intentionally left behind.
    await cleanupLedgerEntriesForUsers([otherUser.id]);
  });

  it("handles a transaction with more than two entries (not just a simple pair)", async () => {
    const user = await makeUser();
    const idempotencyKey = `test-helpers-multi:${user.id}:${crypto.randomUUID()}`;

    // Not a realistic production shape, but proves the helper doesn't assume
    // exactly 2 rows per idempotencyKey — it deletes every row sharing the key.
    await postTransaction({
      entries: [
        { userId: user.id, wallet: "A", direction: "CREDIT", amount: "30", entryType: "ADMIN_CREDIT", comment: "Multi." },
        { userId: user.id, wallet: "B", direction: "CREDIT", amount: "20", entryType: "ADMIN_CREDIT", comment: "Multi." },
        { userId: null, wallet: "SYSTEM_EXTERNAL", direction: "DEBIT", amount: "50", entryType: "ADMIN_CREDIT", comment: "Multi." },
      ],
      idempotencyKey,
    });

    const beforeCleanup = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(beforeCleanup).toHaveLength(3);

    await cleanupLedgerEntriesForUsers([user.id]);

    const afterCleanup = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(afterCleanup).toHaveLength(0);
  });

  it("does nothing and does not throw for an empty user id list", async () => {
    await expect(cleanupLedgerEntriesForUsers([])).resolves.toBeUndefined();
  });

  it("does nothing and does not throw for users with no ledger entries", async () => {
    const user = await makeUser();
    await expect(cleanupLedgerEntriesForUsers([user.id])).resolves.toBeUndefined();
  });
});
