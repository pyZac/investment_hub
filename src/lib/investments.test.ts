import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { adminCreditWalletB } from "./admin-credit";
import { purchasePackage, listInvestmentsForUser, daysUntil } from "./investments";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
const createdEntryIds: string[] = [];
const createdInvestmentIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function getMainAdmin() {
  return prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
}

async function makeUser() {
  const user = await registerAsRoot({
    email: `purchase-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Purchase User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makePackage(amount: string, isActive = true) {
  const pkg = await prisma.package.create({
    data: {
      name: `Test-${crypto.randomUUID()}`,
      amount,
      isActive,
      deactivatedAt: isActive ? null : new Date(),
    },
  });
  createdPackageIds.push(pkg.id);
  return pkg;
}

async function fundWalletB(userId: string, amount: string) {
  const mainAdmin = await getMainAdmin();
  const idempotencyKey = `fund:${userId}:${crypto.randomUUID()}`;
  await adminCreditWalletB(mainAdmin.id, {
    userId,
    amount,
    reason: "Test funding.",
    idempotencyKey,
  });
  const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
  for (const e of entries) createdEntryIds.push(e.id);
}

async function disableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" DISABLE TRIGGER ledger_entries_no_delete`);
}

async function enableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" ENABLE TRIGGER ledger_entries_no_delete`);
}

afterAll(async () => {
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await disableDeleteTrigger();
  await prisma.ledgerEntry.deleteMany({ where: { id: { in: createdEntryIds } } });
  await enableDeleteTrigger();
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("purchasePackage", () => {
  it("debits B, credits A, and creates a correct investment row", async () => {
    const user = await makeUser();
    await fundWalletB(user.id, "1000");
    const pkg = await makePackage("1000");
    const purchasedAt = new Date("2026-08-15T10:00:00.000Z");
    const idempotencyKey = `purchase:${user.id}:${crypto.randomUUID()}`;

    const result = await purchasePackage(user.id, {
      packageId: pkg.id,
      forDate: purchasedAt,
      idempotencyKey,
    });
    createdInvestmentIds.push(result.investment.id);

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    for (const e of entries) createdEntryIds.push(e.id);
    expect(entries).toHaveLength(2);

    const debit = entries.find((e) => e.direction === "DEBIT")!;
    const credit = entries.find((e) => e.direction === "CREDIT")!;
    expect(debit.userId).toBe(user.id);
    expect(debit.wallet).toBe("B");
    expect(credit.userId).toBe(user.id);
    expect(credit.wallet).toBe("A");
    expect(new Prisma.Decimal(debit.amount).eq("1000")).toBe(true);
    expect(new Prisma.Decimal(credit.amount).eq("1000")).toBe(true);

    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "B" } },
    });
    const walletA = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "A" } },
    });
    expect(new Prisma.Decimal(walletB.balance).isZero()).toBe(true);
    expect(new Prisma.Decimal(walletA.balance).eq("1000")).toBe(true);

    const investment = result.investment;
    expect(investment.userId).toBe(user.id);
    expect(investment.packageId).toBe(pkg.id);
    expect(new Prisma.Decimal(investment.amount).eq("1000")).toBe(true);
    expect(investment.status).toBe("ACTIVE");
    expect(investment.purchasedAt.toISOString()).toBe(purchasedAt.toISOString());
    expect(investment.capitalReleasedAt).toBeNull();

    const expectedProfitStart = new Date(purchasedAt);
    expectedProfitStart.setUTCDate(expectedProfitStart.getUTCDate() + 7);
    expect(investment.profitStartsAt.toISOString()).toBe(expectedProfitStart.toISOString());

    const expectedUnlock = new Date(purchasedAt);
    expectedUnlock.setUTCMonth(expectedUnlock.getUTCMonth() + 6);
    expect(investment.capitalUnlocksAt.toISOString()).toBe(expectedUnlock.toISOString());
  });

  it("rejects insufficient Wallet B balance, writing nothing", async () => {
    const user = await makeUser();
    await fundWalletB(user.id, "100");
    const pkg = await makePackage("1000");
    const idempotencyKey = `purchase-insufficient:${user.id}:${crypto.randomUUID()}`;

    await expect(
      purchasePackage(user.id, { packageId: pkg.id, forDate: new Date(), idempotencyKey }),
    ).rejects.toThrow(/insufficient/i);

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(entries).toHaveLength(0);

    const investments = await prisma.investment.findMany({ where: { userId: user.id } });
    expect(investments).toHaveLength(0);

    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "B" } },
    });
    expect(new Prisma.Decimal(walletB.balance).eq("100")).toBe(true);
  });

  it("rejects purchasing a deactivated package", async () => {
    const user = await makeUser();
    await fundWalletB(user.id, "1000");
    const pkg = await makePackage("1000", false);
    const idempotencyKey = `purchase-deactivated:${user.id}:${crypto.randomUUID()}`;

    await expect(
      purchasePackage(user.id, { packageId: pkg.id, forDate: new Date(), idempotencyKey }),
    ).rejects.toThrow(/inactive|deactivated|not (available|purchasable)/i);

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(entries).toHaveLength(0);

    const investments = await prisma.investment.findMany({ where: { userId: user.id } });
    expect(investments).toHaveLength(0);
  });

  it("is idempotent: replaying the same key does not double-charge or duplicate the investment", async () => {
    const user = await makeUser();
    await fundWalletB(user.id, "1000");
    const pkg = await makePackage("1000");
    const idempotencyKey = `purchase-replay:${user.id}:${crypto.randomUUID()}`;
    const forDate = new Date();

    const first = await purchasePackage(user.id, { packageId: pkg.id, forDate, idempotencyKey });
    createdInvestmentIds.push(first.investment.id);

    const second = await purchasePackage(user.id, { packageId: pkg.id, forDate, idempotencyKey });

    expect(second.investment.id).toBe(first.investment.id);

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    for (const e of entries) createdEntryIds.push(e.id);
    expect(entries).toHaveLength(2);

    const investments = await prisma.investment.findMany({ where: { userId: user.id } });
    expect(investments).toHaveLength(1);

    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "B" } },
    });
    expect(new Prisma.Decimal(walletB.balance).isZero()).toBe(true);
  });
});

describe("listInvestmentsForUser", () => {
  it("returns only the given user's investments, newest first, with package included", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    await fundWalletB(userA.id, "2000");
    await fundWalletB(userB.id, "2000");
    const pkg1 = await makePackage("500");
    const pkg2 = await makePackage("1000");

    const key1 = `list-test-1:${userA.id}:${crypto.randomUUID()}`;
    const first = await purchasePackage(userA.id, {
      packageId: pkg1.id,
      forDate: new Date("2026-01-01T00:00:00.000Z"),
      idempotencyKey: key1,
    });
    createdInvestmentIds.push(first.investment.id);
    (await prisma.ledgerEntry.findMany({ where: { idempotencyKey: key1 } })).forEach((e) =>
      createdEntryIds.push(e.id),
    );

    const key2 = `list-test-2:${userA.id}:${crypto.randomUUID()}`;
    const second = await purchasePackage(userA.id, {
      packageId: pkg2.id,
      forDate: new Date("2026-02-01T00:00:00.000Z"),
      idempotencyKey: key2,
    });
    createdInvestmentIds.push(second.investment.id);
    (await prisma.ledgerEntry.findMany({ where: { idempotencyKey: key2 } })).forEach((e) =>
      createdEntryIds.push(e.id),
    );

    const key3 = `list-test-3:${userB.id}:${crypto.randomUUID()}`;
    const otherUsersInvestment = await purchasePackage(userB.id, {
      packageId: pkg1.id,
      forDate: new Date(),
      idempotencyKey: key3,
    });
    createdInvestmentIds.push(otherUsersInvestment.investment.id);
    (await prisma.ledgerEntry.findMany({ where: { idempotencyKey: key3 } })).forEach((e) =>
      createdEntryIds.push(e.id),
    );

    const results = await listInvestmentsForUser(userA.id);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe(second.investment.id);
    expect(results[1].id).toBe(first.investment.id);
    expect(results.every((r) => r.userId === userA.id)).toBe(true);
    expect(results[0].package.name).toBe(pkg2.name);
  });

  it("returns an empty array for a user with no investments", async () => {
    const user = await makeUser();
    const results = await listInvestmentsForUser(user.id);
    expect(results).toEqual([]);
  });
});

describe("daysUntil", () => {
  it("returns the whole number of days remaining, rounded up", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const target = new Date("2026-01-08T00:00:00.000Z");
    expect(daysUntil(target, now)).toBe(7);
  });

  it("rounds up a partial day", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const target = new Date("2026-01-02T01:00:00.000Z");
    expect(daysUntil(target, now)).toBe(2);
  });

  it("returns 0 once the target has passed", () => {
    const now = new Date("2026-01-10T00:00:00.000Z");
    const target = new Date("2026-01-01T00:00:00.000Z");
    expect(daysUntil(target, now)).toBe(0);
  });

  it("returns 0 exactly at the target instant", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(daysUntil(now, now)).toBe(0);
  });
});
