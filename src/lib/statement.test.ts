import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { adminCreditWalletB } from "./admin-credit";
import { reverseLedgerTransaction } from "./manual-adjustment";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";
import { exportStatementCsvForUser } from "./statement";

const createdUserIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function getMainAdmin() {
  return prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
}

async function makeUser(label = "root") {
  const user = await registerAsRoot({
    email: `statement-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Statement Test User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeSubAdmin() {
  const admin = await prisma.user.create({
    data: {
      email: `statement-subadmin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Statement Test Sub-Admin",
      role: "ADMIN",
    },
  });
  createdUserIds.push(admin.id);
  return admin;
}

afterAll(async () => {
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.adminAction.deleteMany({ where: { targetUserId: { in: createdUserIds } } });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("exportStatementCsvForUser", () => {
  it("generates a CSV containing every one of the user's own ledger rows, with 2dp-rounded amounts", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("clean");

    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "104.995",
      reason: "Statement export test credit needing round-half-up display.",
      idempotencyKey: `test-statement-clean:${user.id}:${crypto.randomUUID()}`,
    });

    const csv = await exportStatementCsvForUser(user.id, user.id);

    const lines = csv.split("\n");
    expect(lines[0]).toBe("Date,User,Wallet,Entry Type,Direction,Amount,Comment");
    // header + exactly one data row for this user's single transaction.
    expect(lines.length).toBe(2);

    // Stored value is 104.99500000 (8dp); displayed statement value must be
    // the round-half-up 2dp figure, not the raw ledger precision.
    expect(csv).toContain("105.00");
    expect(csv).not.toContain("104.995");
    expect(csv).toContain("CREDIT");
    expect(csv).toContain("Admin Credit");
  });

  it("never includes the paired SYSTEM_EXTERNAL row — only the user's own side of each transaction", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("no-system-external");

    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "50",
      reason: "Statement export SYSTEM_EXTERNAL-exclusion test.",
      idempotencyKey: `test-statement-sysext:${user.id}:${crypto.randomUUID()}`,
    });

    const csv = await exportStatementCsvForUser(user.id, user.id);

    expect(csv).not.toContain("Platform Reserve");
    const lines = csv.split("\n");
    expect(lines.length).toBe(2);
  });

  it("includes reversal entries alongside the original, since a reversal is a new ledger row for the same user", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("reversal");

    const idempotencyKey = `test-statement-reversal:${user.id}:${crypto.randomUUID()}`;
    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "200",
      reason: "Statement export reversal test — original credit.",
      idempotencyKey,
    });

    await reverseLedgerTransaction(mainAdmin.id, {
      idempotencyKey,
      reason: "Statement export reversal test — reversing the credit.",
    });

    const csv = await exportStatementCsvForUser(user.id, user.id);
    const lines = csv.split("\n").slice(1);
    // Original CREDIT + reversal DEBIT, both on the user's own side.
    expect(lines.length).toBe(2);
    expect(csv).toContain("200.00");
  });

  it("rejects a user exporting another user's statement", async () => {
    const user = await makeUser("victim");
    const attacker = await makeUser("attacker");

    await expect(exportStatementCsvForUser(attacker.id, user.id)).rejects.toThrow(/forbidden/i);
  });

  it("allows a main admin to export any user's statement", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("admin-export");

    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "75",
      reason: "Statement export admin-access test.",
      idempotencyKey: `test-statement-admin:${user.id}:${crypto.randomUUID()}`,
    });

    const csv = await exportStatementCsvForUser(mainAdmin.id, user.id);
    expect(csv).toContain("75.00");
  });

  it("allows a sub-admin with LEDGER_VIEW to export any user's statement", async () => {
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "LEDGER_VIEW" },
    });
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("subadmin-export");

    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "30",
      reason: "Statement export sub-admin-access test.",
      idempotencyKey: `test-statement-subadmin:${user.id}:${crypto.randomUUID()}`,
    });

    const csv = await exportStatementCsvForUser(subAdmin.id, user.id);
    expect(csv).toContain("30.00");
  });

  it("rejects a sub-admin without LEDGER_VIEW exporting another user's statement", async () => {
    const subAdmin = await makeSubAdmin();
    const user = await makeUser("subadmin-no-perm");

    await expect(exportStatementCsvForUser(subAdmin.id, user.id)).rejects.toThrow(/forbidden/i);
  });

  it("returns just the header for a user with no ledger history", async () => {
    const user = await makeUser("empty");

    const csv = await exportStatementCsvForUser(user.id, user.id);

    expect(csv).toBe("Date,User,Wallet,Entry Type,Direction,Amount,Comment");
  });
});
