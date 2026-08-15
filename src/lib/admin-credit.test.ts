import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
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
    email: `admin-credit-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Admin Credit User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeAdmin() {
  const admin = await prisma.user.create({
    data: {
      email: `admin-credit-admin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test Admin",
      role: "ADMIN",
    },
  });
  createdUserIds.push(admin.id);
  return admin;
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
  await prisma.adminAction.deleteMany({
    where: { OR: [{ targetUserId: { in: createdUserIds } }, { adminId: { in: createdUserIds } }] },
  });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("adminCreditWalletB", () => {
  it("credits Wallet B and posts the SYSTEM_EXTERNAL side correctly, and logs to admin_actions", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const idempotencyKey = `test-credit:${user.id}:${crypto.randomUUID()}`;

    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "1000",
      reason: "Manual top-up for testing.",
      idempotencyKey,
    });

    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "B" } },
    });
    expect(new Prisma.Decimal(walletB.balance).eq("1000")).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    for (const e of entries) createdEntryIds.push(e.id);
    expect(entries).toHaveLength(2);

    const credit = entries.find((e) => e.direction === "CREDIT")!;
    const debit = entries.find((e) => e.direction === "DEBIT")!;
    expect(credit.userId).toBe(user.id);
    expect(credit.wallet).toBe("B");
    expect(debit.userId).toBeNull();
    expect(debit.wallet).toBe("SYSTEM_EXTERNAL");

    const action = await prisma.adminAction.findFirst({
      where: { targetUserId: user.id, actionType: "CREDIT_ISSUANCE" },
    });
    expect(action).not.toBeNull();
    expect(action?.adminId).toBe(mainAdmin.id);
    expect(action?.reason).toBe("Manual top-up for testing.");
    expect(new Prisma.Decimal(action!.amount!).eq("1000")).toBe(true);
  });

  it("rejects a missing/empty reason", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();

    await expect(
      adminCreditWalletB(mainAdmin.id, {
        userId: user.id,
        amount: "500",
        reason: "",
        idempotencyKey: `test-noreason:${user.id}:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow();

    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "B" } },
    });
    expect(new Prisma.Decimal(walletB.balance).isZero()).toBe(true);
  });

  it("rejects a non-admin acting user", async () => {
    const nonAdmin = await makeUser();
    const target = await makeUser();

    await expect(
      adminCreditWalletB(nonAdmin.id, {
        userId: target.id,
        amount: "500",
        reason: "Should not be allowed.",
        idempotencyKey: `test-nonadmin:${target.id}:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("rejects a sub-admin without CREDIT_ISSUANCE", async () => {
    const subAdmin = await makeAdmin();
    const target = await makeUser();

    await expect(
      adminCreditWalletB(subAdmin.id, {
        userId: target.id,
        amount: "500",
        reason: "Should not be allowed.",
        idempotencyKey: `test-nogrant:${target.id}:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow(/forbidden|CREDIT_ISSUANCE/i);
  });

  it("allows a sub-admin with CREDIT_ISSUANCE", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "CREDIT_ISSUANCE" },
    });
    const target = await makeUser();
    const idempotencyKey = `test-grant:${target.id}:${crypto.randomUUID()}`;

    await adminCreditWalletB(subAdmin.id, {
      userId: target.id,
      amount: "300",
      reason: "Sub-admin issuance.",
      idempotencyKey,
    });

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    for (const e of entries) createdEntryIds.push(e.id);
    expect(entries).toHaveLength(2);
  });

  it("is idempotent: replaying the same key does not double-credit", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const idempotencyKey = `test-credit-replay:${user.id}:${crypto.randomUUID()}`;

    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "750",
      reason: "First call.",
      idempotencyKey,
    });
    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "750",
      reason: "Replayed call.",
      idempotencyKey,
    });

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    for (const e of entries) createdEntryIds.push(e.id);
    expect(entries).toHaveLength(2);

    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "B" } },
    });
    expect(new Prisma.Decimal(walletB.balance).eq("750")).toBe(true);
  });
});
