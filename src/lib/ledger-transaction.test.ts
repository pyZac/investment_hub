import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";
import { registerAsRoot } from "./users";

const createdUserIds: string[] = [];
const createdEntryIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeUser() {
  const user = await registerAsRoot({
    email: `ledger-tx-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Ledger Tx User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function disableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" DISABLE TRIGGER ledger_entries_no_delete`);
}

async function enableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" ENABLE TRIGGER ledger_entries_no_delete`);
}

afterAll(async () => {
  await disableDeleteTrigger();
  await prisma.ledgerEntry.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { id: { in: createdEntryIds } } });
  await enableDeleteTrigger();
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("postTransaction", () => {
  it("writes both entries and updates both cached balances for a balanced transaction", async () => {
    const user = await makeUser();
    const idempotencyKey = `test-admin-credit:${user.id}:${crypto.randomUUID()}`;

    await postTransaction({
      entries: [
        { userId: user.id, wallet: "B", direction: "CREDIT", amount: "1000", entryType: "ADMIN_CREDIT", comment: "Admin credit issuance." },
        { userId: null, wallet: "SYSTEM_EXTERNAL", direction: "DEBIT", amount: "1000", entryType: "ADMIN_CREDIT", comment: "Admin credit issuance." },
      ],
      idempotencyKey,
    });

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(entries).toHaveLength(2);
    for (const e of entries) createdEntryIds.push(e.id);

    const credit = entries.find((e) => e.direction === "CREDIT")!;
    const debit = entries.find((e) => e.direction === "DEBIT")!;
    expect(credit.userId).toBe(user.id);
    expect(credit.wallet).toBe("B");
    expect(new Prisma.Decimal(credit.amount).eq("1000")).toBe(true);
    expect(debit.userId).toBeNull();
    expect(debit.wallet).toBe("SYSTEM_EXTERNAL");

    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "B" } },
    });
    expect(new Prisma.Decimal(walletB.balance).eq("1000")).toBe(true);
  });

  it("rejects an unbalanced transaction (debits != credits) and writes nothing", async () => {
    const user = await makeUser();
    const idempotencyKey = `test-unbalanced:${user.id}:${crypto.randomUUID()}`;

    await expect(
      postTransaction({
        entries: [
          { userId: user.id, wallet: "B", direction: "CREDIT", amount: "1000", entryType: "ADMIN_CREDIT", comment: "x" },
          { userId: null, wallet: "SYSTEM_EXTERNAL", direction: "DEBIT", amount: "999", entryType: "ADMIN_CREDIT", comment: "x" },
        ],
        idempotencyKey,
      }),
    ).rejects.toThrow(/debits.*credits|balanc/i);

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(entries).toHaveLength(0);

    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "B" } },
    });
    expect(new Prisma.Decimal(walletB.balance).isZero()).toBe(true);
  });

  it("is idempotent: replaying the same key creates no duplicate entries and does not double-apply the balance", async () => {
    const user = await makeUser();
    const idempotencyKey = `test-replay:${user.id}:${crypto.randomUUID()}`;
    const entries = [
      { userId: user.id, wallet: "B" as const, direction: "CREDIT" as const, amount: "500", entryType: "ADMIN_CREDIT" as const, comment: "Admin credit issuance." },
      { userId: null, wallet: "SYSTEM_EXTERNAL" as const, direction: "DEBIT" as const, amount: "500", entryType: "ADMIN_CREDIT" as const, comment: "Admin credit issuance." },
    ];

    await postTransaction({ entries, idempotencyKey });
    await postTransaction({ entries, idempotencyKey });

    const rows = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(rows).toHaveLength(2);
    for (const e of rows) createdEntryIds.push(e.id);

    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "B" } },
    });
    expect(new Prisma.Decimal(walletB.balance).eq("500")).toBe(true);
  });

  it("posts a SYSTEM_EXTERNAL-side entry correctly, with no WalletAccount row for it", async () => {
    const user = await makeUser();
    const idempotencyKey = `test-system-external:${user.id}:${crypto.randomUUID()}`;

    await postTransaction({
      entries: [
        { userId: user.id, wallet: "B", direction: "CREDIT", amount: "250", entryType: "ADMIN_CREDIT", comment: "Admin credit issuance." },
        { userId: null, wallet: "SYSTEM_EXTERNAL", direction: "DEBIT", amount: "250", entryType: "ADMIN_CREDIT", comment: "Admin credit issuance." },
      ],
      idempotencyKey,
    });

    const rows = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    for (const e of rows) createdEntryIds.push(e.id);

    const systemExternalEntry = rows.find((e) => e.wallet === "SYSTEM_EXTERNAL")!;
    expect(systemExternalEntry.userId).toBeNull();
    expect(systemExternalEntry.direction).toBe("DEBIT");
    expect(new Prisma.Decimal(systemExternalEntry.amount).eq("250")).toBe(true);

    // SYSTEM_EXTERNAL is a ledger-only concept — no user, no WalletAccount row,
    // ever (enforced at the DB level by wallets_type_not_system_external).
    const systemExternalWallets = await prisma.walletAccount.findMany({
      where: { type: "SYSTEM_EXTERNAL" },
    });
    expect(systemExternalWallets).toHaveLength(0);
  });
});
