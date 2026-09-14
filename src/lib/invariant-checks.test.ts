import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { runInvariantChecks } from "./invariant-checks";
import { adminCreditWalletB } from "./admin-credit";
import { registerAsRoot } from "./users";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeUser() {
  const user = await registerAsRoot({
    email: `invariant-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Invariant User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function getMainAdmin() {
  return prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
}

afterAll(async () => {
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.adminAction.deleteMany({ where: { targetUserId: { in: createdUserIds } } });
  await prisma.binaryNode.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("runInvariantChecks", () => {
  it("reports clean for a normally-created user with a real transaction", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();

    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "1000",
      reason: "Invariant-check clean-state test credit.",
      idempotencyKey: `test-invariant-clean:${user.id}:${crypto.randomUUID()}`,
    });

    const report = await runInvariantChecks();

    expect(report.clean).toBe(true);
    expect(report.negativeBalances).toHaveLength(0);
    expect(report.orphanBinaryNodes).toHaveLength(0);
    expect(report.duplicateIdempotencyKeys).toHaveLength(0);
  });

  describe("negative balances", () => {
    it("catches a wallet with a manually-corrupted negative balance", async () => {
      const user = await makeUser();

      await prisma.walletAccount.update({
        where: { userId_type: { userId: user.id, type: "A" } },
        data: { balance: "-25" },
      });

      const report = await runInvariantChecks();

      expect(report.clean).toBe(false);
      expect(report.negativeBalances).toHaveLength(1);
      expect(report.negativeBalances[0]).toMatchObject({
        userId: user.id,
        wallet: "A",
        balance: "-25",
      });

      await expect(runInvariantChecks({ throwOnViolation: true })).rejects.toThrow(
        new RegExp(`${user.id}.*A.*-25|negative balance`, "is"),
      );

      // Restore so this doesn't poison later runs/tests in the same suite.
      await prisma.walletAccount.update({
        where: { userId_type: { userId: user.id, type: "A" } },
        data: { balance: "0" },
      });
    });
  });

  describe("orphan binary nodes", () => {
    it("catches a binary node whose parent_id points at a non-existent node", async () => {
      const user = await makeUser();

      // Bypasses placeInBinaryTree deliberately — normal code paths can never
      // produce this (parentId has an FK to binary_nodes.user_id), so the
      // only way to exercise this check is to disable the FK for one insert,
      // exactly like test-helpers.ts does for the ledger's no-delete trigger.
      await prisma.$executeRawUnsafe(`ALTER TABLE "binary_nodes" DISABLE TRIGGER ALL`);
      try {
        await prisma.binaryNode.create({
          data: {
            userId: user.id,
            parentId: "does-not-exist-orphan-parent",
            path: `/does-not-exist-orphan-parent/${user.id}/`,
            depth: 1,
          },
        });
      } finally {
        await prisma.$executeRawUnsafe(`ALTER TABLE "binary_nodes" ENABLE TRIGGER ALL`);
      }

      const report = await runInvariantChecks();

      expect(report.clean).toBe(false);
      expect(report.orphanBinaryNodes).toHaveLength(1);
      expect(report.orphanBinaryNodes[0]).toMatchObject({
        userId: user.id,
        reason: "parent_not_found",
        parentId: "does-not-exist-orphan-parent",
      });

      await expect(runInvariantChecks({ throwOnViolation: true })).rejects.toThrow(/orphan/i);

      // Clean up immediately rather than waiting for afterAll — a later
      // test in this same file calling runInvariantChecks() and asserting
      // on report.clean must not see this deliberately-manufactured orphan
      // still present.
      await prisma.binaryNode.delete({ where: { userId: user.id } });
    });
  });

  describe("duplicate idempotency keys", () => {
    it("does not false-positive on a real multi-row transaction sharing one idempotency key", async () => {
      const user = await makeUser();

      await adminCreditWalletB(await (await getMainAdmin()).id, {
        userId: user.id,
        amount: "50",
        reason: "Multi-row same-key transaction (credit + paired SYSTEM_EXTERNAL debit).",
        idempotencyKey: `test-invariant-multirow:${user.id}:${crypto.randomUUID()}`,
      });

      // Scoped assertion only: other tests in this file deliberately leave a
      // manufactured orphan binary_nodes row alive until the file's afterAll,
      // so report.clean (which aggregates all three checks) is not a safe
      // assertion here — this test is specifically about the duplicate-key
      // check not false-positiving on a legitimate multi-row transaction.
      const report = await runInvariantChecks();

      expect(report.duplicateIdempotencyKeys).toHaveLength(0);
    });

    it("catches a genuine duplicate row on the real (key, user, wallet, direction) uniqueness scope", async () => {
      const user = await makeUser();
      const dupKey = `test-invariant-realdup:${user.id}:${crypto.randomUUID()}`;

      await adminCreditWalletB(await (await getMainAdmin()).id, {
        userId: user.id,
        amount: "75",
        reason: "Real-duplicate simulation base row.",
        idempotencyKey: dupKey,
      });

      const original = await prisma.ledgerEntry.findFirstOrThrow({
        where: { idempotencyKey: dupKey, userId: user.id, wallet: "B", direction: "CREDIT" },
      });

      // The composite UNIQUE index (idempotency_key, coalesce(user_id,
      // sentinel), wallet, direction) is the exact thing this check exists
      // as defense-in-depth for — to prove the check catches a violation of
      // that same scope, the index itself must be dropped for one insert
      // (a UNIQUE index has no "disable" toggle the way the ledger's
      // append-only trigger does), then recreated exactly as the migration
      // defines it so no other test is exposed to a temporarily-unenforced
      // constraint.
      await prisma.$executeRawUnsafe(
        `DROP INDEX "ledger_entries_idempotency_key_user_id_wallet_direction_key"`,
      );
      let duplicateRowId: string;
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" DISABLE TRIGGER ledger_entries_no_delete`);
        const duplicateRow = await prisma.ledgerEntry.create({
          data: {
            userId: user.id,
            wallet: "B",
            direction: "CREDIT",
            amount: original.amount,
            entryType: original.entryType,
            idempotencyKey: dupKey,
            comment: "Deliberately duplicated row for invariant-check test.",
          },
        });
        duplicateRowId = duplicateRow.id;
        await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" ENABLE TRIGGER ledger_entries_no_delete`);

        const report = await runInvariantChecks();

        expect(report.clean).toBe(false);
        expect(report.duplicateIdempotencyKeys).toHaveLength(1);
        expect(report.duplicateIdempotencyKeys[0]).toMatchObject({
          idempotencyKey: dupKey,
          userId: user.id,
          wallet: "B",
          direction: "CREDIT",
          count: 2,
        });

        await expect(runInvariantChecks({ throwOnViolation: true })).rejects.toThrow(/duplicate/i);
      } finally {
        // Delete ONLY the manufactured duplicate row by its own id (ledger
        // no-delete trigger already re-enabled above) — NOT a
        // where-clause match on idempotencyKey/wallet/direction, which
        // would also delete the legitimate original row and leave its
        // paired SYSTEM_EXTERNAL debit permanently orphaned (afterAll's
        // cleanupLedgerEntriesForUsers can only find that pairing via the
        // user's own still-existing row). The legitimate original + its
        // SYSTEM_EXTERNAL sibling are left for afterAll to clean up
        // normally. Then restore the real index exactly as the migration
        // defines it.
        await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" DISABLE TRIGGER ledger_entries_no_delete`);
        await prisma.ledgerEntry.delete({ where: { id: duplicateRowId! } });
        await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" ENABLE TRIGGER ledger_entries_no_delete`);
        await prisma.$executeRawUnsafe(
          `CREATE UNIQUE INDEX "ledger_entries_idempotency_key_user_id_wallet_direction_key"
             ON "ledger_entries"("idempotency_key", (COALESCE("user_id", 'SYSTEM_EXTERNAL')), "wallet", "direction")`,
        );
      }
    });
  });
});
