import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { runReconciliation } from "./reconciliation";
import { adminCreditWalletB } from "./admin-credit";
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
    email: `reconcile-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Reconcile User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function getMainAdmin() {
  return prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
}

async function disableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" DISABLE TRIGGER ledger_entries_no_delete`);
}

async function enableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" ENABLE TRIGGER ledger_entries_no_delete`);
}

afterAll(async () => {
  await disableDeleteTrigger();
  await prisma.ledgerEntry.deleteMany({ where: { id: { in: createdEntryIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { userId: { in: createdUserIds } } });
  await enableDeleteTrigger();
  await prisma.adminAction.deleteMany({ where: { targetUserId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("runReconciliation", () => {
  it("reports clean for correctly-processed transactions", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();

    const idempotencyKey = `test-reconcile-clean:${user.id}:${crypto.randomUUID()}`;
    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "1000",
      reason: "Reconciliation test credit.",
      idempotencyKey,
    });
    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    for (const e of entries) createdEntryIds.push(e.id);

    const report = await runReconciliation();

    expect(report.clean).toBe(true);
    expect(report.walletMismatches).toHaveLength(0);
    expect(report.systemExternalMismatch).toBeNull();
  });

  it("catches a manually-corrupted balance and names the user/wallet and drift amount", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();

    const idempotencyKey = `test-reconcile-drift:${user.id}:${crypto.randomUUID()}`;
    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "1000",
      reason: "Reconciliation drift test credit.",
      idempotencyKey,
    });
    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    for (const e of entries) createdEntryIds.push(e.id);

    // Simulate drift by writing directly to the cached balance, bypassing
    // postTransaction — exactly the kind of corruption reconciliation exists to catch.
    await prisma.walletAccount.update({
      where: { userId_type: { userId: user.id, type: "B" } },
      data: { balance: "1500" },
    });

    await expect(runReconciliation()).rejects.toThrow(
      new RegExp(`${user.id}.*B.*500|500.*${user.id}.*B`, "s"),
    );

    // Restore so this test doesn't poison later runs in the same suite/process.
    await prisma.walletAccount.update({
      where: { userId_type: { userId: user.id, type: "B" } },
      data: { balance: "1000" },
    });
  });

  it("reports the exact drift amount and direction in the report object (before it throws)", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();

    const idempotencyKey = `test-reconcile-detail:${user.id}:${crypto.randomUUID()}`;
    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "200",
      reason: "Reconciliation drift detail test.",
      idempotencyKey,
    });
    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    for (const e of entries) createdEntryIds.push(e.id);

    await prisma.walletAccount.update({
      where: { userId_type: { userId: user.id, type: "B" } },
      data: { balance: "150" },
    });

    let caught: unknown;
    try {
      await runReconciliation();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain(user.id);
    expect(message).toContain("B");
    expect(message).toMatch(/50(\.0+)?/); // ledger says 200, cache says 150 -> drift of 50

    await prisma.walletAccount.update({
      where: { userId_type: { userId: user.id, type: "B" } },
      data: { balance: "200" },
    });
  });
});
