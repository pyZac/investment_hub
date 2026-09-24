import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot, registerWithSponsor } from "./users";
import { adminCreditWalletB } from "./admin-credit";
import { purchasePackage } from "./investments";
import { payDirectCommission, listDirectCommissionHistoryForUser } from "./direct-commission";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
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
    email: `direct-commission-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Direct Commission Test User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makePackage(amount: string) {
  const pkg = await prisma.package.create({
    data: { name: `Test-${crypto.randomUUID()}`, amount, isActive: true },
  });
  createdPackageIds.push(pkg.id);
  return pkg;
}

async function fundWalletB(userId: string, amount: string) {
  const mainAdmin = await getMainAdmin();
  await adminCreditWalletB(mainAdmin.id, {
    userId,
    amount,
    reason: "Test funding.",
    idempotencyKey: `fund:${userId}:${crypto.randomUUID()}`,
  });
}

async function makeSponsoredUser(sponsorId: string) {
  const user = await registerWithSponsor(sponsorId, {
    email: `direct-commission-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Direct Commission Sponsored User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makePurchase(userId: string, packageId: string, forDate: Date) {
  const result = await purchasePackage(userId, {
    packageId,
    forDate,
    idempotencyKey: `purchase:${userId}:${crypto.randomUUID()}`,
  });
  createdInvestmentIds.push(result.investment.id);
  return result.investment;
}

async function suspend(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { suspendedAt: new Date() } });
}

afterAll(async () => {
  await prisma.mrvPeriod.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.savingLot.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.bvEntry.deleteMany({ where: { sourceInvestmentId: { in: createdInvestmentIds } } });
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.binaryNode.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("payDirectCommission", () => {
  it("splits a purchase 5%/3% into the sponsor's C and SAVING wallets, with a matching saving_lot", async () => {
    const sponsor = await makeUser();
    const buyer = await makeSponsoredUser(sponsor.id);
    await fundWalletB(buyer.id, "10000");
    const pkg = await makePackage("10000");
    const purchasedAt = new Date("2026-08-01T10:00:00.000Z");

    const investment = await makePurchase(buyer.id, pkg.id, purchasedAt);
    await payDirectCommission(investment.id, purchasedAt);

    const sponsorC = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: sponsor.id, type: "C" } },
    });
    const sponsorSaving = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: sponsor.id, type: "SAVING" } },
    });
    expect(new Prisma.Decimal(sponsorC.balance).eq("500")).toBe(true);
    expect(new Prisma.Decimal(sponsorSaving.balance).eq("300")).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({
      where: {
        referenceType: "investment",
        referenceId: investment.id,
        entryType: { in: ["DIRECT_COMMISSION", "DIRECT_SAVING"] },
      },
    });
    expect(entries).toHaveLength(4);
    const commissionCredit = entries.find((e) => e.entryType === "DIRECT_COMMISSION" && e.direction === "CREDIT")!;
    const savingCredit = entries.find((e) => e.entryType === "DIRECT_SAVING" && e.direction === "CREDIT")!;
    expect(commissionCredit.userId).toBe(sponsor.id);
    expect(commissionCredit.wallet).toBe("C");
    expect(new Prisma.Decimal(commissionCredit.amount).eq("500")).toBe(true);
    expect(savingCredit.userId).toBe(sponsor.id);
    expect(savingCredit.wallet).toBe("SAVING");
    expect(new Prisma.Decimal(savingCredit.amount).eq("300")).toBe(true);

    const lots = await prisma.savingLot.findMany({ where: { userId: sponsor.id } });
    expect(lots).toHaveLength(1);
    expect(new Prisma.Decimal(lots[0].amount).eq("300")).toBe(true);
    expect(lots[0].sourceInvestmentId).toBe(investment.id);
    const expectedUnlock = new Date(purchasedAt);
    expectedUnlock.setUTCMonth(expectedUnlock.getUTCMonth() + 3);
    expect(lots[0].unlocksAt.toISOString()).toBe(expectedUnlock.toISOString());
    expect(lots[0].releasedAt).toBeNull();
  });

  it("does nothing when the buyer has no sponsor", async () => {
    const buyer = await makeUser();
    await fundWalletB(buyer.id, "10000");
    const pkg = await makePackage("10000");
    const investment = await makePurchase(buyer.id, pkg.id, new Date("2026-08-01T10:00:00.000Z"));

    await payDirectCommission(investment.id, new Date("2026-08-01T10:00:00.000Z"));

    const entries = await prisma.ledgerEntry.findMany({
      where: {
        referenceType: "investment",
        referenceId: investment.id,
        entryType: { in: ["DIRECT_COMMISSION", "DIRECT_SAVING"] },
      },
    });
    expect(entries).toHaveLength(0);
  });

  it("pays commission on a SECOND purchase by the same buyer too, not just the first (2026-09-24 rule change: every purchase counts)", async () => {
    const sponsor = await makeUser();
    const buyer = await makeSponsoredUser(sponsor.id);
    await fundWalletB(buyer.id, "60000");
    const pkg1 = await makePackage("1000");
    const pkg2 = await makePackage("50000");

    const first = await makePurchase(buyer.id, pkg1.id, new Date("2026-08-01T10:00:00.000Z"));
    await payDirectCommission(first.id, new Date("2026-08-01T10:00:00.000Z"));

    const second = await makePurchase(buyer.id, pkg2.id, new Date("2026-09-01T10:00:00.000Z"));
    await payDirectCommission(second.id, new Date("2026-09-01T10:00:00.000Z"));

    const secondEntries = await prisma.ledgerEntry.findMany({
      where: {
        referenceType: "investment",
        referenceId: second.id,
        entryType: { in: ["DIRECT_COMMISSION", "DIRECT_SAVING"] },
      },
    });
    expect(secondEntries).toHaveLength(4);
    const secondCommissionCredit = secondEntries.find(
      (e) => e.entryType === "DIRECT_COMMISSION" && e.direction === "CREDIT",
    )!;
    const secondSavingCredit = secondEntries.find(
      (e) => e.entryType === "DIRECT_SAVING" && e.direction === "CREDIT",
    )!;
    // 5%/3% of 50000 = 2500/1500, on top of the first purchase's 50/30 (5%/3% of 1000).
    expect(new Prisma.Decimal(secondCommissionCredit.amount).eq("2500")).toBe(true);
    expect(new Prisma.Decimal(secondSavingCredit.amount).eq("1500")).toBe(true);

    // Two purchases -> two saving_lot rows, one per triggering investment.
    const lots = await prisma.savingLot.findMany({ where: { userId: sponsor.id }, orderBy: { createdAt: "asc" } });
    expect(lots).toHaveLength(2);
    expect(lots[0].sourceInvestmentId).toBe(first.id);
    expect(lots[1].sourceInvestmentId).toBe(second.id);

    const sponsorC = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: sponsor.id, type: "C" } },
    });
    // 50 (from the 1000 purchase) + 2500 (from the 50000 purchase) = 2550.
    expect(new Prisma.Decimal(sponsorC.balance).eq("2550")).toBe(true);
  });

  it("blocks the commission when the sponsor is suspended", async () => {
    const sponsor = await makeUser();
    const buyer = await makeSponsoredUser(sponsor.id);
    await suspend(sponsor.id);
    await fundWalletB(buyer.id, "10000");
    const pkg = await makePackage("10000");
    const investment = await makePurchase(buyer.id, pkg.id, new Date("2026-08-01T10:00:00.000Z"));

    await payDirectCommission(investment.id, new Date("2026-08-01T10:00:00.000Z"));

    const entries = await prisma.ledgerEntry.findMany({
      where: {
        referenceType: "investment",
        referenceId: investment.id,
        entryType: { in: ["DIRECT_COMMISSION", "DIRECT_SAVING"] },
      },
    });
    expect(entries).toHaveLength(0);
    const lots = await prisma.savingLot.findMany({ where: { userId: sponsor.id } });
    expect(lots).toHaveLength(0);
  });

  it("blocks the commission when the buyer is suspended", async () => {
    const sponsor = await makeUser();
    const buyer = await makeSponsoredUser(sponsor.id);
    await fundWalletB(buyer.id, "10000");
    const pkg = await makePackage("10000");
    await suspend(buyer.id);

    const investment = await makePurchase(buyer.id, pkg.id, new Date("2026-08-01T10:00:00.000Z"));

    const entries = await prisma.ledgerEntry.findMany({
      where: {
        referenceType: "investment",
        referenceId: investment.id,
        entryType: { in: ["DIRECT_COMMISSION", "DIRECT_SAVING"] },
      },
    });
    expect(entries).toHaveLength(0);
    const lots = await prisma.savingLot.findMany({ where: { userId: sponsor.id } });
    expect(lots).toHaveLength(0);
  });

  it("is idempotent: replaying the same investment does not double-credit or duplicate the saving_lot", async () => {
    const sponsor = await makeUser();
    const buyer = await makeSponsoredUser(sponsor.id);
    await fundWalletB(buyer.id, "10000");
    const pkg = await makePackage("10000");
    const purchasedAt = new Date("2026-08-01T10:00:00.000Z");
    const investment = await makePurchase(buyer.id, pkg.id, purchasedAt);

    await payDirectCommission(investment.id, purchasedAt);
    await payDirectCommission(investment.id, purchasedAt);

    const entries = await prisma.ledgerEntry.findMany({
      where: {
        referenceType: "investment",
        referenceId: investment.id,
        entryType: { in: ["DIRECT_COMMISSION", "DIRECT_SAVING"] },
      },
    });
    expect(entries).toHaveLength(4);

    const lots = await prisma.savingLot.findMany({ where: { userId: sponsor.id } });
    expect(lots).toHaveLength(1);

    const sponsorC = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: sponsor.id, type: "C" } },
    });
    expect(new Prisma.Decimal(sponsorC.balance).eq("500")).toBe(true);
  });
});

describe("purchasePackage + payDirectCommission wiring (SCRUM-66)", () => {
  it("a single purchasePackage call both creates the investment AND pays the sponsor's commission", async () => {
    const sponsor = await makeUser();
    const buyer = await makeSponsoredUser(sponsor.id);
    await fundWalletB(buyer.id, "10000");
    const pkg = await makePackage("10000");
    const purchasedAt = new Date("2026-08-01T10:00:00.000Z");
    const idempotencyKey = `purchase:${buyer.id}:${crypto.randomUUID()}`;

    const result = await purchasePackage(buyer.id, { packageId: pkg.id, forDate: purchasedAt, idempotencyKey });
    createdInvestmentIds.push(result.investment.id);

    expect(result.investment.userId).toBe(buyer.id);

    const sponsorC = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: sponsor.id, type: "C" } },
    });
    const sponsorSaving = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: sponsor.id, type: "SAVING" } },
    });
    expect(new Prisma.Decimal(sponsorC.balance).eq("500")).toBe(true);
    expect(new Prisma.Decimal(sponsorSaving.balance).eq("300")).toBe(true);

    const lots = await prisma.savingLot.findMany({ where: { userId: sponsor.id } });
    expect(lots).toHaveLength(1);
    expect(lots[0].sourceInvestmentId).toBe(result.investment.id);
  });

  it("a forced mid-commission failure rolls back the whole purchase — no investment, no purchase entries, no commission entries", async () => {
    const sponsor = await makeUser();
    const buyer = await makeSponsoredUser(sponsor.id);
    await fundWalletB(buyer.id, "10000");
    const pkg = await makePackage("10000");
    const purchasedAt = new Date("2026-08-01T10:00:00.000Z");
    const idempotencyKey = `purchase:${buyer.id}:${crypto.randomUUID()}`;

    // The investment doesn't exist yet, so its id is unknown in advance —
    // but purchasePackage always creates it via investment.create(), whose
    // auto-generated cuid is unknown to us. Instead, force the failure by
    // pre-populating the *package* funding path to succeed but poisoning
    // the commission_config lookup: temporarily close out every active
    // commission_config row so payDirectCommissionInTx's
    // findFirstOrThrow(effectiveTo: null) throws. Restored in a finally
    // block so this shared dev-DB config row is never left broken for
    // other tests, regardless of pass/fail.
    const activeConfig = await prisma.commissionConfig.findFirstOrThrow({ where: { effectiveTo: null } });
    await prisma.commissionConfig.update({
      where: { id: activeConfig.id },
      data: { effectiveTo: new Date("2000-01-01T00:00:00.000Z") },
    });

    try {
      await expect(
        purchasePackage(buyer.id, { packageId: pkg.id, forDate: purchasedAt, idempotencyKey }),
      ).rejects.toThrow();
    } finally {
      await prisma.commissionConfig.update({
        where: { id: activeConfig.id },
        data: { effectiveTo: null },
      });
    }

    const investments = await prisma.investment.findMany({ where: { userId: buyer.id } });
    expect(investments).toHaveLength(0);

    const purchaseEntries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(purchaseEntries).toHaveLength(0);

    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: buyer.id, type: "B" } },
    });
    expect(new Prisma.Decimal(walletB.balance).eq("10000")).toBe(true);

    const sponsorC = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: sponsor.id, type: "C" } },
    });
    expect(new Prisma.Decimal(sponsorC.balance).isZero()).toBe(true);

    const lots = await prisma.savingLot.findMany({ where: { userId: sponsor.id } });
    expect(lots).toHaveLength(0);
  });
});

describe("listDirectCommissionHistoryForUser", () => {
  it("returns the sponsor's own commission credits (both C and SAVING sides), newest first, excluding the SYSTEM_EXTERNAL debit side", async () => {
    const sponsor = await makeUser();
    const buyer = await makeSponsoredUser(sponsor.id);
    await fundWalletB(buyer.id, "10000");
    const pkg = await makePackage("10000");
    const purchasedAt = new Date("2026-08-01T10:00:00.000Z");

    const investment = await makePurchase(buyer.id, pkg.id, purchasedAt);

    const history = await listDirectCommissionHistoryForUser(sponsor.id);

    expect(history).toHaveLength(2);
    const commissionRow = history.find((h) => h.wallet === "C")!;
    const savingRow = history.find((h) => h.wallet === "SAVING")!;
    expect(new Prisma.Decimal(commissionRow.amount).eq("500")).toBe(true);
    expect(new Prisma.Decimal(savingRow.amount).eq("300")).toBe(true);
    expect(commissionRow.investmentId).toBe(investment.id);
    expect(savingRow.investmentId).toBe(investment.id);
    expect(commissionRow.direction).toBe("CREDIT");
    expect(savingRow.direction).toBe("CREDIT");
  });

  it("returns an empty array for a user with no commission history", async () => {
    const user = await makeUser();
    const history = await listDirectCommissionHistoryForUser(user.id);
    expect(history).toEqual([]);
  });

  it("never includes another user's commission entries", async () => {
    const sponsorA = await makeUser();
    const buyerA = await makeSponsoredUser(sponsorA.id);
    await fundWalletB(buyerA.id, "10000");
    const pkgA = await makePackage("10000");
    await makePurchase(buyerA.id, pkgA.id, new Date("2026-08-01T10:00:00.000Z"));

    const sponsorB = await makeUser();

    const historyB = await listDirectCommissionHistoryForUser(sponsorB.id);
    expect(historyB).toEqual([]);
  });
});
