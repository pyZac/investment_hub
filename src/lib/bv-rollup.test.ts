import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { registerAsRoot, registerWithSponsor } from "./users";
import { purchasePackage } from "./investments";
import { adminCreditWalletB } from "./admin-credit";
import { accrueDailyInterestForInvestment } from "./daily-interest";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
const createdInvestmentIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

afterAll(async () => {
  await prisma.mrvPeriod.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.bvEntry.deleteMany({ where: { ancestorUserId: { in: createdUserIds } } });
  await prisma.savingLot.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.binaryNode.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function makeRoot(label: string) {
  const user = await registerAsRoot({
    email: `bvroll-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: label,
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeReferral(sponsorId: string, label: string) {
  const user = await registerWithSponsor(sponsorId, {
    email: `bvroll-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: label,
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeAndFundPackage(amount: string) {
  const pkg = await prisma.package.create({
    data: { name: `BvRollTest-${crypto.randomUUID()}`, amount, isActive: true },
  });
  createdPackageIds.push(pkg.id);
  return pkg;
}

async function fundWalletB(userId: string, amount: string) {
  const mainAdmin = await prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
  await adminCreditWalletB(mainAdmin.id, {
    userId,
    amount,
    reason: "Test funding for BV rollup.",
    idempotencyKey: `bvroll-fund:${userId}:${crypto.randomUUID()}`,
  });
}

describe("BV rollup on purchase", () => {
  it("creates a bv_entries row for every ancestor, on the correct leg, with matching cached totals", async () => {
    // Build: root -> left (root's LEFT) -> leftLeft (left's LEFT) -> buyer (leftLeft's LEFT)
    const root = await makeRoot("multi-root");
    const left = await makeReferral(root.id, "multi-left"); // root's LEFT
    await makeReferral(root.id, "multi-right"); // root's RIGHT (fills the other slot)
    const leftLeft = await makeReferral(left.id, "multi-left-left"); // left's LEFT
    const buyer = await makeReferral(leftLeft.id, "multi-buyer"); // leftLeft's LEFT

    await fundWalletB(buyer.id, "5000");
    const pkg = await makeAndFundPackage("5000");
    const purchaseDate = new Date("2026-08-24T10:00:00.000Z"); // a Monday
    const result = await purchasePackage(buyer.id, {
      packageId: pkg.id,
      forDate: purchaseDate,
      idempotencyKey: `bvroll-purchase:${buyer.id}:${crypto.randomUUID()}`,
    });
    createdInvestmentIds.push(result.investment.id);

    const rootEntry = await prisma.bvEntry.findUniqueOrThrow({
      where: { ancestorUserId_sourceInvestmentId: { ancestorUserId: root.id, sourceInvestmentId: result.investment.id } },
    });
    expect(rootEntry.leg).toBe("LEFT");
    expect(rootEntry.amount.equals("5000")).toBe(true);

    const leftEntry = await prisma.bvEntry.findUniqueOrThrow({
      where: { ancestorUserId_sourceInvestmentId: { ancestorUserId: left.id, sourceInvestmentId: result.investment.id } },
    });
    expect(leftEntry.leg).toBe("LEFT");

    const leftLeftEntry = await prisma.bvEntry.findUniqueOrThrow({
      where: { ancestorUserId_sourceInvestmentId: { ancestorUserId: leftLeft.id, sourceInvestmentId: result.investment.id } },
    });
    expect(leftLeftEntry.leg).toBe("LEFT");

    // No entry at all for the buyer themselves.
    const buyerEntry = await prisma.bvEntry.findUnique({
      where: { ancestorUserId_sourceInvestmentId: { ancestorUserId: buyer.id, sourceInvestmentId: result.investment.id } },
    });
    expect(buyerEntry).toBeNull();

    const rootNode = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: root.id } });
    expect(rootNode.leftBv.equals("5000")).toBe(true);
    expect(rootNode.rightBv.equals(0)).toBe(true);

    const leftNode = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: left.id } });
    expect(leftNode.leftBv.equals("5000")).toBe(true);

    const leftLeftNode = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: leftLeft.id } });
    expect(leftLeftNode.leftBv.equals("5000")).toBe(true);

    // cycle_week_start should be the Saturday at/before the purchase date
    // (2026-08-22 is the Saturday preceding Monday 2026-08-24).
    expect(rootEntry.cycleWeekStart.toISOString()).toBe("2026-08-21T20:00:00.000Z");
  });

  it("creates zero bv_entries for a DAILY_INTEREST credit or a DIRECT_COMMISSION credit", async () => {
    const sponsor = await makeRoot("noise-sponsor");
    const buyer = await makeReferral(sponsor.id, "noise-buyer");

    await fundWalletB(buyer.id, "1000");
    const pkg = await makeAndFundPackage("1000");
    const purchaseDate = new Date("2026-08-24T10:00:00.000Z");
    const result = await purchasePackage(buyer.id, {
      packageId: pkg.id,
      forDate: purchaseDate,
      idempotencyKey: `bvroll-noise-purchase:${buyer.id}:${crypto.randomUUID()}`,
    });
    createdInvestmentIds.push(result.investment.id);

    const bvEntriesAfterPurchase = await prisma.bvEntry.count({
      where: { ancestorUserId: sponsor.id },
    });
    const sponsorNodeAfterPurchase = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: sponsor.id } });

    // Direct Commission already fired as part of purchasePackage itself
    // (sponsor's C/SAVING credited) — assert it added no bv_entries beyond
    // the purchase's own single rollup entry for the sponsor.
    expect(bvEntriesAfterPurchase).toBe(1);

    // Now accrue daily interest on the same investment — a profit credit,
    // never BV-generating.
    const accrualDate = new Date(purchaseDate.getTime() + 8 * 24 * 60 * 60 * 1000); // past profitStartsAt (+7 days)
    await accrueDailyInterestForInvestment(result.investment.id, accrualDate);

    const bvEntriesAfterInterest = await prisma.bvEntry.count({
      where: { ancestorUserId: sponsor.id },
    });
    const sponsorNodeAfterInterest = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: sponsor.id } });

    expect(bvEntriesAfterInterest).toBe(1); // unchanged
    expect(sponsorNodeAfterInterest.leftBv.toString()).toBe(sponsorNodeAfterPurchase.leftBv.toString());
    expect(sponsorNodeAfterInterest.rightBv.toString()).toBe(sponsorNodeAfterPurchase.rightBv.toString());
  });

  it("does not double-count when the same investment's BV rollup is replayed", async () => {
    const sponsor = await makeRoot("replay-sponsor");
    const buyer = await makeReferral(sponsor.id, "replay-buyer");

    await fundWalletB(buyer.id, "2000");
    const pkg = await makeAndFundPackage("2000");
    const purchaseDate = new Date("2026-08-24T10:00:00.000Z");
    const idempotencyKey = `bvroll-replay-purchase:${buyer.id}:${crypto.randomUUID()}`;

    const first = await purchasePackage(buyer.id, { packageId: pkg.id, forDate: purchaseDate, idempotencyKey });
    createdInvestmentIds.push(first.investment.id);

    const sponsorNodeAfterFirst = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: sponsor.id } });
    const entryCountAfterFirst = await prisma.bvEntry.count({ where: { ancestorUserId: sponsor.id } });

    // Replaying the exact same purchase call (same idempotencyKey) hits
    // purchasePackage's own "already processed" short-circuit before
    // rollupBvForPurchase would even run again — proves the end-to-end
    // path is replay-safe, not just the internal rollup function alone.
    const second = await purchasePackage(buyer.id, { packageId: pkg.id, forDate: purchaseDate, idempotencyKey });
    expect(second.alreadyProcessed).toBe(true);
    expect(second.investment.id).toBe(first.investment.id);

    const sponsorNodeAfterSecond = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: sponsor.id } });
    const entryCountAfterSecond = await prisma.bvEntry.count({ where: { ancestorUserId: sponsor.id } });

    expect(entryCountAfterSecond).toBe(entryCountAfterFirst);
    expect(sponsorNodeAfterSecond.leftBv.toString()).toBe(sponsorNodeAfterFirst.leftBv.toString());
    expect(sponsorNodeAfterSecond.rightBv.toString()).toBe(sponsorNodeAfterFirst.rightBv.toString());

    // Also directly re-invoke the internal rollup function itself for the
    // same investmentId, bypassing purchasePackage's own short-circuit
    // entirely, to prove bv_entries' UNIQUE constraint is the real guard.
    const { rollupBvForPurchase } = await import("./binary-tree");
    await prisma.$transaction((tx) => rollupBvForPurchase(first.investment.id, buyer.id, "2000", purchaseDate, tx));

    const sponsorNodeAfterDirectReplay = await prisma.binaryNode.findUniqueOrThrow({ where: { userId: sponsor.id } });
    const entryCountAfterDirectReplay = await prisma.bvEntry.count({ where: { ancestorUserId: sponsor.id } });

    expect(entryCountAfterDirectReplay).toBe(entryCountAfterFirst);
    expect(sponsorNodeAfterDirectReplay.leftBv.toString()).toBe(sponsorNodeAfterFirst.leftBv.toString());
  });
});
