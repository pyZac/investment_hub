import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { registerAsRoot, registerWithSponsor } from "./users";
import { adminCreditWalletB } from "./admin-credit";
import { purchasePackage } from "./investments";
import {
  dubaiMonthKey,
  evaluateRankForUser,
  payQueuedRankRewards,
  editRankConfig,
  createRankConfig,
  chooseRankReward,
} from "./rank";
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

async function makeSubAdmin() {
  const admin = await prisma.user.create({
    data: {
      email: `mrv-subadmin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test Sub-Admin",
      role: "ADMIN",
    },
  });
  createdUserIds.push(admin.id);
  return admin;
}

async function makeUser(label = "root") {
  const user = await registerAsRoot({
    email: `mrv-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "MRV Test User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeSponsoredUser(sponsorId: string, label = "sponsored") {
  const user = await registerWithSponsor(sponsorId, {
    email: `mrv-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "MRV Sponsored User",
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

async function makePurchase(userId: string, packageId: string, forDate: Date) {
  const result = await purchasePackage(userId, {
    packageId,
    forDate,
    idempotencyKey: `purchase:${userId}:${crypto.randomUUID()}`,
  });
  createdInvestmentIds.push(result.investment.id);
  return result.investment;
}

/**
 * Directly seeds an mrv_periods row for a user/month, bypassing real
 * purchases — rank threshold tests need MRV values up to 100,000,000 (OG),
 * far too large to build via real $100-$100,000 package purchases in a unit
 * test. accrueMrvForPurchase's own correctness is already covered by the
 * "MRV accrual on purchase" describe block above; these tests only need a
 * known MRV number to evaluate against rank_config.
 */
async function seedMrv(userId: string, month: string, volume: string) {
  await prisma.mrvPeriod.upsert({
    where: { userId_month: { userId, month } },
    create: { userId, month, volume },
    update: { volume },
  });
}

/**
 * Gives `userId` an active investment of their own — several rank rules
 * require the user themselves to hold an active investment, independent of
 * their MRV/referral numbers.
 */
async function giveActiveInvestment(userId: string, forDate: Date) {
  await fundWalletB(userId, "100");
  const pkg = await makePackage("100");
  await makePurchase(userId, pkg.id, forDate);
}

afterAll(async () => {
  await prisma.adminAction.deleteMany({ where: { adminId: { in: createdUserIds } } });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.rankForfeit.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.rankAward.deleteMany({ where: { userId: { in: createdUserIds } } });
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

describe("dubaiMonthKey", () => {
  it("formats a date as YYYY-MM in Asia/Dubai", () => {
    expect(dubaiMonthKey(new Date("2026-08-15T10:00:00.000Z"))).toBe("2026-08");
  });

  it("a date just before Dubai midnight on the 1st still belongs to the prior month", () => {
    // 2026-08-31T20:00:00.000Z is 2026-09-01T00:00:00 in Asia/Dubai (UTC+4) —
    // the boundary case where a naive UTC-based month key would be wrong.
    expect(dubaiMonthKey(new Date("2026-08-31T19:59:59.999Z"))).toBe("2026-08");
    expect(dubaiMonthKey(new Date("2026-08-31T20:00:00.000Z"))).toBe("2026-09");
  });
});

describe("MRV accrual on purchase (via purchasePackage)", () => {
  it("a referral's first purchase and a later reinvestment both add to the sponsor's MRV", async () => {
    const sponsor = await makeUser("sponsor-accrual");
    const referral = await makeSponsoredUser(sponsor.id, "referral-accrual");
    const pkg = await makePackage("1000");
    const forDate = new Date("2026-09-05T10:00:00.000Z");

    await fundWalletB(referral.id, "1000");
    await makePurchase(referral.id, pkg.id, forDate);

    const afterFirst = await prisma.mrvPeriod.findUniqueOrThrow({
      where: { userId_month: { userId: sponsor.id, month: "2026-09" } },
    });
    expect(afterFirst.volume.equals("1000")).toBe(true);

    // Reinvestment: a second purchase by the same referral, same month — MRV
    // has no first-purchase-only gate (deliberately different from Direct
    // Commission), so this must add on top, not be skipped.
    await fundWalletB(referral.id, "1000");
    await makePurchase(referral.id, pkg.id, new Date("2026-09-10T10:00:00.000Z"));

    const afterSecond = await prisma.mrvPeriod.findUniqueOrThrow({
      where: { userId_month: { userId: sponsor.id, month: "2026-09" } },
    });
    expect(afterSecond.volume.equals("2000")).toBe(true);
  });

  it("a direct referral's own downline's purchase does NOT count toward the original sponsor's MRV", async () => {
    const grandSponsor = await makeUser("grandsponsor-depth");
    const middleReferral = await makeSponsoredUser(grandSponsor.id, "middle-depth");
    const leafReferral = await makeSponsoredUser(middleReferral.id, "leaf-depth");
    const pkg = await makePackage("5000");
    const forDate = new Date("2026-09-06T10:00:00.000Z");

    await fundWalletB(leafReferral.id, "5000");
    await makePurchase(leafReferral.id, pkg.id, forDate);

    // The leaf's purchase should credit the MIDDLE referral (leaf's direct
    // sponsor), never the grandSponsor two levels up — MRV is depth=1 only.
    const middlePeriod = await prisma.mrvPeriod.findUniqueOrThrow({
      where: { userId_month: { userId: middleReferral.id, month: "2026-09" } },
    });
    expect(middlePeriod.volume.equals("5000")).toBe(true);

    const grandSponsorPeriod = await prisma.mrvPeriod.findUnique({
      where: { userId_month: { userId: grandSponsor.id, month: "2026-09" } },
    });
    expect(grandSponsorPeriod).toBeNull();
  });

  it("MRV correctly resets to 0 in a new calendar month (no carry forward)", async () => {
    const sponsor = await makeUser("sponsor-reset");
    const referral = await makeSponsoredUser(sponsor.id, "referral-reset");
    const septemberPkg = await makePackage("3000");
    const octoberPkg = await makePackage("1500");

    await fundWalletB(referral.id, "3000");
    await makePurchase(referral.id, septemberPkg.id, new Date("2026-09-20T10:00:00.000Z"));

    await fundWalletB(referral.id, "1500");
    await makePurchase(referral.id, octoberPkg.id, new Date("2026-10-02T10:00:00.000Z"));

    const septemberPeriod = await prisma.mrvPeriod.findUniqueOrThrow({
      where: { userId_month: { userId: sponsor.id, month: "2026-09" } },
    });
    expect(septemberPeriod.volume.equals("3000")).toBe(true);

    const octoberPeriod = await prisma.mrvPeriod.findUniqueOrThrow({
      where: { userId_month: { userId: sponsor.id, month: "2026-10" } },
    });
    // A fresh row for the new month, starting from this purchase alone —
    // NOT 4500 (3000 carried + 1500), proving no carry forward.
    expect(octoberPeriod.volume.equals("1500")).toBe(true);
  });

  it("a purchase by a non-referred (root) user doesn't affect anyone's MRV", async () => {
    const rootUser = await makeUser("no-sponsor");
    const pkg = await makePackage("2000");
    const forDate = new Date("2026-09-07T10:00:00.000Z");

    await fundWalletB(rootUser.id, "2000");
    await makePurchase(rootUser.id, pkg.id, forDate);

    // The buyer has no sponsor at all — no mrv_periods row should be created
    // for anyone as a result of this purchase, including the buyer
    // themselves (MRV only ever accrues to a DIRECT SPONSOR, never a
    // self-credit).
    const anyPeriodForBuyer = await prisma.mrvPeriod.findUnique({
      where: { userId_month: { userId: rootUser.id, month: "2026-09" } },
    });
    expect(anyPeriodForBuyer).toBeNull();
  });
});

describe("evaluateRankForUser", () => {
  it("grants the rank immediately when both MRV and qualified-referral thresholds are met (exit-test scenario: 4 referrals + 100,000 MRV -> Partner)", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await makeUser("partner-exact");
    await giveActiveInvestment(sponsor.id, forDate);

    for (let i = 0; i < 4; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `partner-exact-ref-${i}`);
      await giveActiveInvestment(referral.id, forDate);
    }
    await seedMrv(sponsor.id, "2026-09", "100000");

    const result = await evaluateRankForUser(sponsor.id, "2026-09", forDate);
    expect(result.granted).toBe(true);
    expect(result.rank).toBe("Partner");

    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Partner" } },
    });
    expect(award.achievedMonth).toBe("2026-09");
    expect(award.rewardAmount.equals("2000")).toBe(true);
    expect(award.rewardType).toBe("CASH_OR_TRIP");
    expect(award.creditedAt).toBeNull();
    expect(award.idempotencyKey).toBe(`rank_reward:${sponsor.id}:Partner`);
  });

  it("crossing multiple thresholds in one month grants only the highest rank — Investor's reward is NOT also paid", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await makeUser("multi-threshold");
    await giveActiveInvestment(sponsor.id, forDate);

    // 4 qualified referrals + 100,000 MRV clears BOTH Investor (25,000/2) AND
    // Partner (100,000/4) in the same month.
    for (let i = 0; i < 4; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `multi-threshold-ref-${i}`);
      await giveActiveInvestment(referral.id, forDate);
    }
    await seedMrv(sponsor.id, "2026-09", "100000");

    const result = await evaluateRankForUser(sponsor.id, "2026-09", forDate);
    expect(result.granted).toBe(true);
    expect(result.rank).toBe("Partner");

    const partnerAward = await prisma.rankAward.findUnique({
      where: { userId_rank: { userId: sponsor.id, rank: "Partner" } },
    });
    expect(partnerAward).not.toBeNull();

    const investorAward = await prisma.rankAward.findUnique({
      where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
    });
    expect(investorAward).toBeNull();

    // Investor was crossed this same month but lost to Partner — recorded as
    // forfeited, not merely absent, so it can never be claimed later either.
    const investorForfeit = await prisma.rankForfeit.findUnique({
      where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
    });
    expect(investorForfeit).not.toBeNull();
    expect(investorForfeit!.forfeitMonth).toBe("2026-09");
  });

  it("repeating the same qualifying performance in a later month grants nothing (already awarded)", async () => {
    const septemberDate = new Date("2026-09-15T10:00:00.000Z");
    const octoberDate = new Date("2026-10-15T10:00:00.000Z");
    const sponsor = await makeUser("repeat-performance");
    await giveActiveInvestment(sponsor.id, septemberDate);

    for (let i = 0; i < 4; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `repeat-performance-ref-${i}`);
      await giveActiveInvestment(referral.id, septemberDate);
    }
    await seedMrv(sponsor.id, "2026-09", "100000");

    const septemberResult = await evaluateRankForUser(sponsor.id, "2026-09", septemberDate);
    expect(septemberResult.granted).toBe(true);
    expect(septemberResult.rank).toBe("Partner");

    // Same MRV performance repeated in October — the referrals are still
    // qualified (still active), and October's own MRV independently clears
    // the Partner threshold again.
    await seedMrv(sponsor.id, "2026-10", "100000");

    const octoberResult = await evaluateRankForUser(sponsor.id, "2026-10", octoberDate);
    expect(octoberResult.granted).toBe(false);

    const partnerAwards = await prisma.rankAward.findMany({
      where: { userId: sponsor.id, rank: "Partner" },
    });
    expect(partnerAwards).toHaveLength(1);
    expect(partnerAwards[0].achievedMonth).toBe("2026-09");
  });

  it("a user meeting only MRV (not the referral count) is not granted", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await makeUser("mrv-only");
    await giveActiveInvestment(sponsor.id, forDate);

    // Only 1 qualified referral — Investor needs 2, so even Investor is not
    // met despite MRV clearing every threshold up to Partner.
    const referral = await makeSponsoredUser(sponsor.id, "mrv-only-ref");
    await giveActiveInvestment(referral.id, forDate);
    await seedMrv(sponsor.id, "2026-09", "100000");

    const result = await evaluateRankForUser(sponsor.id, "2026-09", forDate);
    expect(result.granted).toBe(false);

    const anyAward = await prisma.rankAward.findFirst({ where: { userId: sponsor.id } });
    expect(anyAward).toBeNull();
  });

  it("a user meeting only the referral count (not MRV) is not granted", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await makeUser("referrals-only");
    await giveActiveInvestment(sponsor.id, forDate);

    for (let i = 0; i < 4; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `referrals-only-ref-${i}`);
      await giveActiveInvestment(referral.id, forDate);
    }
    // MRV far short of even Investor's 25,000.
    await seedMrv(sponsor.id, "2026-09", "100");

    const result = await evaluateRankForUser(sponsor.id, "2026-09", forDate);
    expect(result.granted).toBe(false);

    const anyAward = await prisma.rankAward.findFirst({ where: { userId: sponsor.id } });
    expect(anyAward).toBeNull();
  });

  it("the user themselves must hold an active investment, even with both thresholds met", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    // Sponsor deliberately never gets an active investment of their own.
    const sponsor = await makeUser("no-own-investment");

    for (let i = 0; i < 4; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `no-own-investment-ref-${i}`);
      await giveActiveInvestment(referral.id, forDate);
    }
    await seedMrv(sponsor.id, "2026-09", "100000");

    const result = await evaluateRankForUser(sponsor.id, "2026-09", forDate);
    expect(result.granted).toBe(false);

    const anyAward = await prisma.rankAward.findFirst({ where: { userId: sponsor.id } });
    expect(anyAward).toBeNull();
  });
});

describe("payQueuedRankRewards", () => {
  it("a rank granted mid-week doesn't pay until the sweep actually runs (queued, not auto-credited on grant)", async () => {
    const wednesday = new Date("2026-09-16T10:00:00.000Z"); // a Wednesday
    const sponsor = await makeUser("midweek-grant");
    await giveActiveInvestment(sponsor.id, wednesday);
    // Investor requires 2 qualified direct referrals.
    for (let i = 0; i < 2; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `midweek-grant-ref-${i}`);
      await giveActiveInvestment(referral.id, wednesday);
    }
    await seedMrv(sponsor.id, "2026-09", "25000");

    const evalResult = await evaluateRankForUser(sponsor.id, "2026-09", wednesday);
    expect(evalResult.granted).toBe(true);
    expect(evalResult.rank).toBe("Investor");

    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
    });
    expect(award.creditedAt).toBeNull();

    // The rank reward itself has NOT been credited — no ledger entry exists
    // under its idempotency key. (Wallet C may already hold a nonzero
    // balance from the referrals' own Direct Commission payouts to this
    // sponsor, which is unrelated real money and not what this test is
    // checking — the rank award's own idempotencyKey is the precise scope.)
    const rewardLedgerEntries = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: award.idempotencyKey },
    });
    expect(rewardLedgerEntries).toHaveLength(0);
  });

  it("a CASH reward pays exactly the config-snapshotted amount on the Friday sweep, idempotently", async () => {
    const wednesday = new Date("2026-09-16T10:00:00.000Z");
    const friday = new Date("2026-09-18T10:00:00.000Z");
    const sponsor = await makeUser("cash-payout");
    await giveActiveInvestment(sponsor.id, wednesday);
    for (let i = 0; i < 2; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `cash-payout-ref-${i}`);
      await giveActiveInvestment(referral.id, wednesday);
    }
    await seedMrv(sponsor.id, "2026-09", "25000");

    await evaluateRankForUser(sponsor.id, "2026-09", wednesday);

    // payQueuedRankRewards sweeps every currently-queued award in the
    // shared dev DB (a real production sweep must — it has no per-user
    // scope), so other tests' queued awards may ride along in this same
    // call. Assert the SPECIFIC award's own settlement directly rather
    // than an exact global paid count. Wallet C may also already hold a
    // nonzero balance from the referrals' own Direct Commission payouts to
    // this sponsor (unrelated real money) — so the reward's own ledger
    // entry (scoped by its idempotencyKey), not an absolute wallet balance,
    // is the precise proof of what THIS payout did.
    const summary = await payQueuedRankRewards(friday);
    expect(summary.paid).toBeGreaterThanOrEqual(1);

    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
    });
    expect(award.creditedAt).not.toBeNull();

    const ledgerEntries = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: award.idempotencyKey },
    });
    // Investor's seeded reward is exactly $500 — the config-snapshotted
    // amount stored on the award, not re-read from rank_config at payout time.
    expect(ledgerEntries).toHaveLength(2);
    const credit = ledgerEntries.find((e) => e.direction === "CREDIT")!;
    expect(credit.userId).toBe(sponsor.id);
    expect(credit.wallet).toBe("C");
    expect(credit.amount.equals("500")).toBe(true);
    expect(credit.entryType).toBe("RANK_REWARD");

    // Idempotent: sweeping again does not write a second ledger entry for
    // this same award.
    await payQueuedRankRewards(friday);
    const ledgerEntriesAfterReplay = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: award.idempotencyKey },
    });
    expect(ledgerEntriesAfterReplay).toHaveLength(2);
  });

  it("a CASH_OR_TRIP award with cash chosen pays correctly", async () => {
    const wednesday = new Date("2026-09-16T10:00:00.000Z");
    const friday = new Date("2026-09-18T10:00:00.000Z");
    const sponsor = await makeUser("partner-cash-choice");
    await giveActiveInvestment(sponsor.id, wednesday);
    for (let i = 0; i < 4; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `partner-cash-choice-ref-${i}`);
      await giveActiveInvestment(referral.id, wednesday);
    }
    await seedMrv(sponsor.id, "2026-09", "100000");

    await evaluateRankForUser(sponsor.id, "2026-09", wednesday);

    await prisma.rankAward.update({
      where: { userId_rank: { userId: sponsor.id, rank: "Partner" } },
      data: { rewardChoice: "CASH" },
    });

    const summary = await payQueuedRankRewards(friday);
    expect(summary.paid).toBeGreaterThanOrEqual(1);

    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Partner" } },
    });
    expect(award.creditedAt).not.toBeNull();

    // Wallet C may already hold a nonzero balance from the 4 referrals' own
    // Direct Commission payouts to this sponsor — the reward's own ledger
    // entry (scoped by idempotencyKey), not an absolute wallet balance, is
    // the precise proof of what this payout credited.
    const ledgerEntries = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: award.idempotencyKey },
    });
    expect(ledgerEntries).toHaveLength(2);
    const credit = ledgerEntries.find((e) => e.direction === "CREDIT")!;
    expect(credit.userId).toBe(sponsor.id);
    expect(credit.wallet).toBe("C");
    expect(credit.amount.equals("2000")).toBe(true);
  });

  it("a CASH_OR_TRIP award with trip chosen creates no ledger entry but is marked paid/settled", async () => {
    const wednesday = new Date("2026-09-16T10:00:00.000Z");
    const friday = new Date("2026-09-18T10:00:00.000Z");
    const sponsor = await makeUser("partner-trip-choice");
    await giveActiveInvestment(sponsor.id, wednesday);
    for (let i = 0; i < 4; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `partner-trip-choice-ref-${i}`);
      await giveActiveInvestment(referral.id, wednesday);
    }
    await seedMrv(sponsor.id, "2026-09", "100000");

    await evaluateRankForUser(sponsor.id, "2026-09", wednesday);

    await prisma.rankAward.update({
      where: { userId_rank: { userId: sponsor.id, rank: "Partner" } },
      data: { rewardChoice: "TRIP" },
    });

    const summary = await payQueuedRankRewards(friday);
    expect(summary.paid).toBeGreaterThanOrEqual(1);

    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Partner" } },
    });
    // Marked settled...
    expect(award.creditedAt).not.toBeNull();

    // ...but genuinely logged-only: no ledger entry under this award's own
    // idempotency key (Wallet C's raw balance is not checked here — the 4
    // referrals' own Direct Commission payouts to this sponsor already put
    // unrelated real money in it, so the absence of THIS award's ledger
    // entry is the precise, scoped proof of "no ledger credit").
    const ledgerEntries = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: award.idempotencyKey },
    });
    expect(ledgerEntries).toHaveLength(0);
  });

  it("a CASH_OR_TRIP award with no choice made yet stays queued past a Friday sweep, never defaulting", async () => {
    const wednesday = new Date("2026-09-16T10:00:00.000Z");
    const friday = new Date("2026-09-18T10:00:00.000Z");
    const sponsor = await makeUser("partner-no-choice");
    await giveActiveInvestment(sponsor.id, wednesday);
    for (let i = 0; i < 4; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `partner-no-choice-ref-${i}`);
      await giveActiveInvestment(referral.id, wednesday);
    }
    await seedMrv(sponsor.id, "2026-09", "100000");

    await evaluateRankForUser(sponsor.id, "2026-09", wednesday);
    // Deliberately never set rewardChoice.

    // payQueuedRankRewards sweeps every currently-queued award in the DB
    // (a real production sweep must, since it has no per-user scope) — this
    // shared dev DB may have other tests' queued awards in flight too, so
    // assert on THIS sponsor's own award directly rather than the sweep's
    // global counts, which can't be asserted on exactly under sharing.
    const summary = await payQueuedRankRewards(friday);
    expect(summary.paid).toBeGreaterThanOrEqual(0);
    expect(summary.stillQueued).toBeGreaterThanOrEqual(1);

    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Partner" } },
    });
    expect(award.creditedAt).toBeNull();

    const ledgerEntriesBeforeChoice = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: award.idempotencyKey },
    });
    expect(ledgerEntriesBeforeChoice).toHaveLength(0);

    // A later sweep after the choice is finally made pays it correctly —
    // proving it genuinely stayed queued, not silently dropped.
    await prisma.rankAward.update({
      where: { userId_rank: { userId: sponsor.id, rank: "Partner" } },
      data: { rewardChoice: "CASH" },
    });
    const nextFriday = new Date("2026-09-25T10:00:00.000Z");
    const laterSummary = await payQueuedRankRewards(nextFriday);
    expect(laterSummary.paid).toBeGreaterThanOrEqual(1);

    const ledgerEntriesAfterChoice = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: award.idempotencyKey },
    });
    expect(ledgerEntriesAfterChoice).toHaveLength(2);
    const credit = ledgerEntriesAfterChoice.find((e) => e.direction === "CREDIT")!;
    expect(credit.amount.equals("2000")).toBe(true);
  });
});

describe("admin rank CRUD (editRankConfig / createRankConfig)", () => {
  it("editing a rank's threshold takes effect for future evaluations only — a month already evaluated under the OLD threshold is unaffected", async () => {
    const mainAdmin = await getMainAdmin();
    const forDate = new Date("2026-09-15T10:00:00.000Z");

    // Evaluate a user under the REAL seeded Investor threshold (25,000/2)
    // first, so this test proves an edit doesn't retroactively change an
    // already-decided month's outcome.
    const sponsor = await makeUser("edit-future-only");
    await giveActiveInvestment(sponsor.id, forDate);
    for (let i = 0; i < 2; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `edit-future-only-ref-${i}`);
      await giveActiveInvestment(referral.id, forDate);
    }
    await seedMrv(sponsor.id, "2026-09", "25000");
    const septemberResult = await evaluateRankForUser(sponsor.id, "2026-09", forDate);
    expect(septemberResult.granted).toBe(true);
    expect(septemberResult.rank).toBe("Investor");

    const originalInvestorConfig = await prisma.rankConfig.findFirstOrThrow({
      where: { rankName: "Investor", effectiveTo: null },
    });

    try {
      // Admin raises Investor's MRV requirement well above what this
      // sponsor's October MRV will be.
      const edited = await editRankConfig(mainAdmin.id, {
        rankName: "Investor",
        mrvRequired: "9999999",
        forDate,
      });
      expect(edited.mrvRequired.equals("9999999")).toBe(true);
      expect(edited.effectiveTo).toBeNull();

      // The OLD row is now closed, not deleted, not mutated in place.
      const closedOriginal = await prisma.rankConfig.findUniqueOrThrow({
        where: { id: originalInvestorConfig.id },
      });
      expect(closedOriginal.mrvRequired.equals("25000")).toBe(true);
      expect(closedOriginal.effectiveTo).not.toBeNull();

      // A DIFFERENT sponsor evaluated AFTER the edit, with MRV that would
      // have qualified under the OLD threshold, no longer qualifies under
      // the NEW one — proves the edit is live for future evaluations.
      const laterSponsor = await makeUser("edit-future-only-later");
      const octoberDate = new Date("2026-10-15T10:00:00.000Z");
      await giveActiveInvestment(laterSponsor.id, octoberDate);
      for (let i = 0; i < 2; i++) {
        const referral = await makeSponsoredUser(laterSponsor.id, `edit-future-only-later-ref-${i}`);
        await giveActiveInvestment(referral.id, octoberDate);
      }
      await seedMrv(laterSponsor.id, "2026-10", "25000");
      const octoberResult = await evaluateRankForUser(laterSponsor.id, "2026-10", octoberDate);
      expect(octoberResult.granted).toBe(false);
    } finally {
      // Restore the real seeded Investor config so later tests/dev data
      // aren't left with a broken threshold.
      const nowActive = await prisma.rankConfig.findFirstOrThrow({
        where: { rankName: "Investor", effectiveTo: null },
      });
      await prisma.rankConfig.delete({ where: { id: nowActive.id } });
      await prisma.rankConfig.update({
        where: { id: originalInvestorConfig.id },
        data: { effectiveTo: null },
      });
    }
  });

  it("an already-granted award's snapshotted amount is unaffected by a later config edit", async () => {
    const mainAdmin = await getMainAdmin();
    const forDate = new Date("2026-09-15T10:00:00.000Z");

    const sponsor = await makeUser("edit-no-retro");
    await giveActiveInvestment(sponsor.id, forDate);
    for (let i = 0; i < 2; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `edit-no-retro-ref-${i}`);
      await giveActiveInvestment(referral.id, forDate);
    }
    await seedMrv(sponsor.id, "2026-09", "25000");
    await evaluateRankForUser(sponsor.id, "2026-09", forDate);

    const awardBeforeEdit = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
    });
    expect(awardBeforeEdit.rewardAmount.equals("500")).toBe(true);

    const originalInvestorConfig = await prisma.rankConfig.findFirstOrThrow({
      where: { rankName: "Investor", effectiveTo: null },
    });

    try {
      await editRankConfig(mainAdmin.id, {
        rankName: "Investor",
        rewardAmount: "999999",
        forDate,
      });

      // The already-granted award is untouched — still the ORIGINAL
      // snapshotted $500, not the new config's $999,999.
      const awardAfterEdit = await prisma.rankAward.findUniqueOrThrow({
        where: { userId_rank: { userId: sponsor.id, rank: "Investor" } },
      });
      expect(awardAfterEdit.rewardAmount.equals("500")).toBe(true);
      expect(awardAfterEdit.id).toBe(awardBeforeEdit.id);

      // Confirm this by actually running the payout sweep: it pays the
      // OLD $500, never the new $999,999, since the award stored its own
      // amount at grant time.
      const friday = new Date("2026-09-18T10:00:00.000Z");
      await payQueuedRankRewards(friday);
      const ledgerEntries = await prisma.ledgerEntry.findMany({
        where: { idempotencyKey: awardBeforeEdit.idempotencyKey },
      });
      const credit = ledgerEntries.find((e) => e.direction === "CREDIT")!;
      expect(credit.amount.equals("500")).toBe(true);
    } finally {
      const nowActive = await prisma.rankConfig.findFirstOrThrow({
        where: { rankName: "Investor", effectiveTo: null },
      });
      await prisma.rankConfig.delete({ where: { id: nowActive.id } });
      await prisma.rankConfig.update({
        where: { id: originalInvestorConfig.id },
        data: { effectiveTo: null },
      });
    }
  });

  it("an admin without the RANK_CONFIG grant is rejected", async () => {
    const subAdmin = await makeSubAdmin();
    const forDate = new Date("2026-09-15T10:00:00.000Z");

    await expect(
      editRankConfig(subAdmin.id, { rankName: "Investor", mrvRequired: "1", forDate }),
    ).rejects.toThrow(/forbidden/i);

    await expect(
      createRankConfig(subAdmin.id, {
        rankName: "Legend",
        mrvRequired: "200000000",
        directReferralsRequired: 25,
        rewardAmount: "5000000",
        rewardType: "CASH",
        rankOrder: 9,
        forDate,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("a sub-admin WITH the RANK_CONFIG grant is allowed", async () => {
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "RANK_CONFIG" },
    });
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const originalInvestorConfig = await prisma.rankConfig.findFirstOrThrow({
      where: { rankName: "Investor", effectiveTo: null },
    });

    try {
      const edited = await editRankConfig(subAdmin.id, {
        rankName: "Investor",
        directReferralsRequired: 3,
        forDate,
      });
      expect(edited.directReferralsRequired).toBe(3);

      const action = await prisma.adminAction.findFirst({
        where: { adminId: subAdmin.id, actionType: "RANK_CONFIG_EDITED" },
      });
      expect(action).not.toBeNull();
    } finally {
      const nowActive = await prisma.rankConfig.findFirstOrThrow({
        where: { rankName: "Investor", effectiveTo: null },
      });
      await prisma.rankConfig.delete({ where: { id: nowActive.id } });
      await prisma.rankConfig.update({
        where: { id: originalInvestorConfig.id },
        data: { effectiveTo: null },
      });
    }
  });

  it("a new rank can be added above OG and becomes evaluable going forward", async () => {
    const mainAdmin = await getMainAdmin();
    const forDate = new Date("2026-09-15T10:00:00.000Z");

    try {
      const created = await createRankConfig(mainAdmin.id, {
        rankName: "Legend",
        mrvRequired: "1000",
        directReferralsRequired: 1,
        rewardAmount: "50",
        rewardType: "CASH",
        rankOrder: 9,
        forDate,
      });
      expect(created.rankName).toBe("Legend");
      expect(created.rankOrder).toBe(9);
      expect(created.effectiveTo).toBeNull();

      const action = await prisma.adminAction.findFirst({
        where: { adminId: mainAdmin.id, actionType: "RANK_CONFIG_CREATED" },
      });
      expect(action).not.toBeNull();

      // Evaluable going forward: a user meeting only "Legend"'s modest
      // thresholds (deliberately far below Investor's 25,000/2) gets
      // "Legend" granted, proving the new rank participates in real
      // evaluation immediately, not just existing as inert config data.
      const sponsor = await makeUser("new-rank-legend");
      await giveActiveInvestment(sponsor.id, forDate);
      const referral = await makeSponsoredUser(sponsor.id, "new-rank-legend-ref");
      await giveActiveInvestment(referral.id, forDate);
      await seedMrv(sponsor.id, "2026-09", "1000");

      const result = await evaluateRankForUser(sponsor.id, "2026-09", forDate);
      expect(result.granted).toBe(true);
      expect(result.rank).toBe("Legend");
    } finally {
      await prisma.rankConfig.deleteMany({ where: { rankName: "Legend" } });
    }
  });
});

describe("chooseRankReward", () => {
  async function grantPartnerAward(label: string, forDate: Date) {
    const sponsor = await makeUser(`choice-${label}`);
    await giveActiveInvestment(sponsor.id, forDate);
    for (let i = 0; i < 4; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `choice-${label}-ref-${i}`);
      await giveActiveInvestment(referral.id, forDate);
    }
    await seedMrv(sponsor.id, "2026-09", "100000");
    await evaluateRankForUser(sponsor.id, "2026-09", forDate);
    return sponsor;
  }

  it("records CASH on a pending CASH_OR_TRIP award", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await grantPartnerAward("cash", forDate);

    const updated = await chooseRankReward(sponsor.id, "Partner", "CASH");
    expect(updated.rewardChoice).toBe("CASH");

    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Partner" } },
    });
    expect(award.rewardChoice).toBe("CASH");
  });

  it("records TRIP on a pending CASH_OR_TRIP award", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await grantPartnerAward("trip", forDate);

    const updated = await chooseRankReward(sponsor.id, "Partner", "TRIP");
    expect(updated.rewardChoice).toBe("TRIP");
  });

  it("rejects if a choice was already made", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await grantPartnerAward("already-chosen", forDate);

    await chooseRankReward(sponsor.id, "Partner", "CASH");

    await expect(chooseRankReward(sponsor.id, "Partner", "TRIP")).rejects.toThrow(/already/i);

    // The original choice is unchanged, not overwritten by the rejected call.
    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Partner" } },
    });
    expect(award.rewardChoice).toBe("CASH");
  });

  it("rejects if the award isn't actually a CASH_OR_TRIP type", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await makeUser("choice-cash-only");
    await giveActiveInvestment(sponsor.id, forDate);
    for (let i = 0; i < 2; i++) {
      const referral = await makeSponsoredUser(sponsor.id, `choice-cash-only-ref-${i}`);
      await giveActiveInvestment(referral.id, forDate);
    }
    await seedMrv(sponsor.id, "2026-09", "25000");
    await evaluateRankForUser(sponsor.id, "2026-09", forDate);

    // Investor is CASH-only, not CASH_OR_TRIP — no choice to make.
    await expect(chooseRankReward(sponsor.id, "Investor", "CASH")).rejects.toThrow(/CASH_OR_TRIP/i);
  });

  it("rejects for a rank the user was never granted", async () => {
    const sponsor = await makeUser("choice-never-granted");
    await expect(chooseRankReward(sponsor.id, "Partner", "CASH")).rejects.toThrow();
  });

  it("ownership: a user cannot record a choice on another user's award", async () => {
    const forDate = new Date("2026-09-15T10:00:00.000Z");
    const sponsor = await grantPartnerAward("owner-check", forDate);
    const otherUser = await makeUser("choice-not-owner");

    // otherUser has no Partner award of their own — this must fail exactly
    // like "never granted," not silently affect sponsor's real award.
    await expect(chooseRankReward(otherUser.id, "Partner", "CASH")).rejects.toThrow();

    const award = await prisma.rankAward.findUniqueOrThrow({
      where: { userId_rank: { userId: sponsor.id, rank: "Partner" } },
    });
    expect(award.rewardChoice).toBeNull();
  });
});
