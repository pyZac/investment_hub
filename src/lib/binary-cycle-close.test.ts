import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { closeBinaryCycleForUser } from "./binary-cycle";
import { registerAsRoot, registerWithSponsor, suspendUser } from "./users";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
const createdInvestmentIds: string[] = [];
const createdCycleIds: string[] = [];
const createdConfigIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

// 2026-08-22 is a Saturday; 2026-08-28 is the following Friday (Asia/Dubai).
const WEEK_START = new Date("2026-08-21T20:00:00.000Z"); // Saturday 00:00 Dubai
const WEEK_END = new Date("2026-08-28T19:59:59.999Z"); // Friday 23:59 Dubai

afterAll(async () => {
  await prisma.binaryCycle.deleteMany({ where: { id: { in: createdCycleIds } } });
  await prisma.bvEntry.deleteMany({ where: { ancestorUserId: { in: createdUserIds } } });
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.binaryNode.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  if (createdConfigIds.length > 0) {
    await prisma.commissionConfig.deleteMany({ where: { id: { in: createdConfigIds } } });
  }
});

async function makeRoot(label: string) {
  const user = await registerAsRoot({
    email: `close-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: label,
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeReferral(sponsorId: string, label: string) {
  const user = await registerWithSponsor(sponsorId, {
    email: `close-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: label,
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

/** Directly creates an ACTIVE investment (no purchase flow needed for these tests). */
async function makeActiveInvestment(userId: string, amount: string) {
  const pkg = await prisma.package.create({
    data: { name: `CloseTest-${crypto.randomUUID()}`, amount, isActive: true },
  });
  createdPackageIds.push(pkg.id);

  const investment = await prisma.investment.create({
    data: {
      userId,
      packageId: pkg.id,
      amount,
      purchasedAt: new Date("2026-01-01T00:00:00.000Z"),
      profitStartsAt: new Date("2026-01-08T00:00:00.000Z"),
      capitalUnlocksAt: new Date("2027-01-01T00:00:00.000Z"),
      referenceId: `close-seed:${crypto.randomUUID()}`,
    },
  });
  createdInvestmentIds.push(investment.id);
  return investment;
}

/** Inserts a bv_entries row directly for `ancestorUserId`, bypassing the real rollup path. */
async function seedBvEntry(ancestorUserId: string, sourceInvestmentId: string, leg: "LEFT" | "RIGHT", amount: string, cycleWeekStart: Date) {
  await prisma.bvEntry.create({
    data: { ancestorUserId, sourceInvestmentId, leg, amount, cycleWeekStart },
  });
}

/** Builds a minimal 2-level tree: sponsor with LEFT and RIGHT direct children, both active. */
async function makeQualifiedSponsor(label: string) {
  const sponsor = await makeRoot(label);
  const leftChild = await makeReferral(sponsor.id, `${label}-left`);
  const rightChild = await makeReferral(sponsor.id, `${label}-right`);
  await makeActiveInvestment(sponsor.id, "100"); // sponsor's own active investment
  const leftInvestment = await makeActiveInvestment(leftChild.id, "100");
  const rightInvestment = await makeActiveInvestment(rightChild.id, "100");
  return { sponsor, leftChild, rightChild, leftInvestment, rightInvestment };
}

describe("closeBinaryCycleForUser", () => {
  it("worked example from the spec: carryLeftIn 8000 + this week's BV -> left 15000/right 7000 -> pay 8% x 7000 = 560, next cycle opens 8000/0", async () => {
    const { sponsor, leftInvestment, rightInvestment } = await makeQualifiedSponsor("worked-example");

    // Seed a prior cycle with carryLeft = 8000, carryRight = 0 (as if last
    // week's own close already produced this carry-out).
    const priorWeekStart = new Date(WEEK_START.getTime() - 7 * 24 * 60 * 60 * 1000);
    const priorCycle = await prisma.binaryCycle.create({
      data: {
        userId: sponsor.id,
        weekStart: priorWeekStart,
        weekEnd: new Date(priorWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000 + 86399999),
        leftVolume: "8000",
        rightVolume: "0",
        matchedVolume: "0",
        commissionPaid: "0",
        carryLeft: "8000",
        carryRight: "0",
        carryLeftSince: priorWeekStart,
        carryRightSince: null,
        qualified: true,
        idempotencyKey: `binary:${sponsor.id}:${priorWeekStart.toISOString()}`,
      },
    });
    createdCycleIds.push(priorCycle.id);

    // This week's fresh BV: LEFT 7000, RIGHT 7000 -> left total 15000, right total 7000.
    await seedBvEntry(sponsor.id, leftInvestment.id, "LEFT", "7000", WEEK_START);
    await seedBvEntry(sponsor.id, rightInvestment.id, "RIGHT", "7000", WEEK_START);

    const cycle = await closeBinaryCycleForUser(sponsor.id, WEEK_START, WEEK_END);
    createdCycleIds.push(cycle.id);

    expect(cycle.qualified).toBe(true);
    expect(new Prisma.Decimal(cycle.leftVolume).toString()).toBe("15000");
    expect(new Prisma.Decimal(cycle.rightVolume).toString()).toBe("7000");
    expect(new Prisma.Decimal(cycle.matchedVolume).toString()).toBe("7000");

    const activeConfig = await prisma.commissionConfig.findFirstOrThrow({ where: { effectiveTo: null } });
    const expectedCommission = new Prisma.Decimal("7000").mul(activeConfig.binaryRate).div(100);
    expect(new Prisma.Decimal(cycle.commissionPaid).toString()).toBe(expectedCommission.toString());
    // Exit test's own numbers assume the seeded 8% rate.
    if (activeConfig.binaryRate.toString() === "8") {
      expect(new Prisma.Decimal(cycle.commissionPaid).toString()).toBe("560");
    }

    // Next cycle opens Left 8000 / Right 0.
    expect(new Prisma.Decimal(cycle.carryLeft).toString()).toBe("8000");
    expect(new Prisma.Decimal(cycle.carryRight).toString()).toBe("0");
    expect(cycle.carryRightSince).toBeNull();
    // The carry-in's original since (last week) carries forward unchanged
    // since it's still unmatched (8000 > 0).
    expect(cycle.carryLeftSince?.toISOString()).toBe(priorWeekStart.toISOString());

    const ledgerCredit = await prisma.ledgerEntry.findFirstOrThrow({
      where: { userId: sponsor.id, wallet: "C", direction: "CREDIT", entryType: "BINARY_COMMISSION" },
    });
    expect(new Prisma.Decimal(ledgerCredit.amount).toString()).toBe(expectedCommission.toString());
  });

  it("an unqualified user (inactive leg) accrues carry in full but is paid nothing", async () => {
    const sponsor = await makeRoot("unqualified");
    const leftChild = await makeReferral(sponsor.id, "unqualified-left");
    await makeReferral(sponsor.id, "unqualified-right"); // RIGHT direct child exists but never gets active capital
    await makeActiveInvestment(sponsor.id, "100");
    const leftInvestment = await makeActiveInvestment(leftChild.id, "100");

    await seedBvEntry(sponsor.id, leftInvestment.id, "LEFT", "5000", WEEK_START);
    // No RIGHT BV at all, and no active capital in the RIGHT leg -> right leg inactive.

    const cycle = await closeBinaryCycleForUser(sponsor.id, WEEK_START, WEEK_END);
    createdCycleIds.push(cycle.id);

    expect(cycle.qualified).toBe(false);
    expect(cycle.qualificationReason).toBe("right_leg_inactive");
    expect(new Prisma.Decimal(cycle.matchedVolume).toString()).toBe("0");
    expect(new Prisma.Decimal(cycle.commissionPaid).toString()).toBe("0");
    // Full carry forward, nothing matched.
    expect(new Prisma.Decimal(cycle.carryLeft).toString()).toBe("5000");
    expect(new Prisma.Decimal(cycle.carryRight).toString()).toBe("0");
    expect(cycle.carryLeftSince?.toISOString()).toBe(WEEK_START.toISOString());

    const ledgerCount = await prisma.ledgerEntry.count({
      where: { userId: sponsor.id, entryType: "BINARY_COMMISSION" },
    });
    expect(ledgerCount).toBe(0);
  });

  it("qualified with equal left/right fully matches both sides down to 0", async () => {
    const { sponsor, leftInvestment, rightInvestment } = await makeQualifiedSponsor("equal-legs");

    await seedBvEntry(sponsor.id, leftInvestment.id, "LEFT", "3000", WEEK_START);
    await seedBvEntry(sponsor.id, rightInvestment.id, "RIGHT", "3000", WEEK_START);

    const cycle = await closeBinaryCycleForUser(sponsor.id, WEEK_START, WEEK_END);
    createdCycleIds.push(cycle.id);

    expect(cycle.qualified).toBe(true);
    expect(new Prisma.Decimal(cycle.matchedVolume).toString()).toBe("3000");
    expect(new Prisma.Decimal(cycle.carryLeft).toString()).toBe("0");
    expect(new Prisma.Decimal(cycle.carryRight).toString()).toBe("0");
    expect(cycle.carryLeftSince).toBeNull();
    expect(cycle.carryRightSince).toBeNull();
  });

  it("uses the binary_rate active during the cycle's own week, not today's current rate", async () => {
    const { sponsor, leftInvestment, rightInvestment } = await makeQualifiedSponsor("historical-rate");

    await seedBvEntry(sponsor.id, leftInvestment.id, "LEFT", "1000", WEEK_START);
    await seedBvEntry(sponsor.id, rightInvestment.id, "RIGHT", "1000", WEEK_START);

    // Close the currently-active config at a boundary BEFORE this cycle's
    // weekEnd, and open a new rate starting right after that boundary — so
    // this cycle's weekEnd falls under the OLD rate, even though the NEW
    // rate is what's "currently active" by the time the test runs.
    const activeConfig = await prisma.commissionConfig.findFirstOrThrow({ where: { effectiveTo: null } });
    const boundary = new Date(WEEK_END.getTime() + 24 * 60 * 60 * 1000); // one day after this cycle closes
    await prisma.commissionConfig.update({ where: { id: activeConfig.id }, data: { effectiveTo: boundary } });
    const newConfig = await prisma.commissionConfig.create({
      data: {
        directRate: activeConfig.directRate,
        directCommissionSplit: activeConfig.directCommissionSplit,
        directSavingSplit: activeConfig.directSavingSplit,
        binaryRate: new Prisma.Decimal("20"), // deliberately different from the old rate
        binaryCarryForwardExpiryMonths: activeConfig.binaryCarryForwardExpiryMonths,
        effectiveFrom: boundary,
        effectiveTo: null,
      },
    });
    createdConfigIds.push(newConfig.id);

    try {
      const cycle = await closeBinaryCycleForUser(sponsor.id, WEEK_START, WEEK_END);
      createdCycleIds.push(cycle.id);

      const expectedCommission = new Prisma.Decimal("1000").mul(activeConfig.binaryRate).div(100);
      expect(new Prisma.Decimal(cycle.commissionPaid).toString()).toBe(expectedCommission.toString());
      // Sanity: definitely not priced at the new 20% rate.
      expect(new Prisma.Decimal(cycle.commissionPaid).toString()).not.toBe("200");
    } finally {
      await prisma.commissionConfig.delete({ where: { id: newConfig.id } });
      createdConfigIds.splice(createdConfigIds.indexOf(newConfig.id), 1);
      await prisma.commissionConfig.update({ where: { id: activeConfig.id }, data: { effectiveTo: null } });
    }
  });

  it("drops a carry-in older than the expiry window, but never this week's fresh BV", async () => {
    const { sponsor, leftInvestment, rightInvestment } = await makeQualifiedSponsor("expiry");

    const activeConfig = await prisma.commissionConfig.findFirstOrThrow({ where: { effectiveTo: null } });
    const expiryMonths = activeConfig.binaryCarryForwardExpiryMonths;

    // Seed a prior cycle whose carryLeftSince is well past the expiry window.
    const staleSince = new Date(WEEK_START);
    staleSince.setUTCMonth(staleSince.getUTCMonth() - (expiryMonths + 1));
    const priorWeekStart = new Date(WEEK_START.getTime() - 7 * 24 * 60 * 60 * 1000);
    const priorCycle = await prisma.binaryCycle.create({
      data: {
        userId: sponsor.id,
        weekStart: priorWeekStart,
        weekEnd: new Date(priorWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000 + 86399999),
        leftVolume: "9000",
        rightVolume: "0",
        matchedVolume: "0",
        commissionPaid: "0",
        carryLeft: "9000",
        carryRight: "0",
        carryLeftSince: staleSince,
        carryRightSince: null,
        qualified: true,
        idempotencyKey: `binary:${sponsor.id}:${priorWeekStart.toISOString()}`,
      },
    });
    createdCycleIds.push(priorCycle.id);

    // This week's fresh LEFT BV (must survive; only the stale 9000 carry-in is dropped).
    await seedBvEntry(sponsor.id, leftInvestment.id, "LEFT", "500", WEEK_START);
    await seedBvEntry(sponsor.id, rightInvestment.id, "RIGHT", "500", WEEK_START);

    const cycle = await closeBinaryCycleForUser(sponsor.id, WEEK_START, WEEK_END);
    createdCycleIds.push(cycle.id);

    // left = 0 (expired carry-in) + 500 fresh = 500, not 9500.
    expect(new Prisma.Decimal(cycle.leftVolume).toString()).toBe("500");
    expect(new Prisma.Decimal(cycle.rightVolume).toString()).toBe("500");
    expect(cycle.qualified).toBe(true);
    expect(new Prisma.Decimal(cycle.matchedVolume).toString()).toBe("500");
  });

  it("does NOT drop a carry-in that is still just inside the expiry window (only just-past-expiry drops, not merely old)", async () => {
    const { sponsor, leftInvestment, rightInvestment } = await makeQualifiedSponsor("expiry-boundary-survives");

    const activeConfig = await prisma.commissionConfig.findFirstOrThrow({ where: { effectiveTo: null } });
    const expiryMonths = activeConfig.binaryCarryForwardExpiryMonths; // the real seeded default (6)

    // One day short of the expiry boundary: weekStart - since is (expiryMonths
    // months minus 1 day), which must NOT count as expired yet.
    const almostStaleSince = new Date(WEEK_START);
    almostStaleSince.setUTCMonth(almostStaleSince.getUTCMonth() - expiryMonths);
    almostStaleSince.setUTCDate(almostStaleSince.getUTCDate() + 1);

    const priorWeekStart = new Date(WEEK_START.getTime() - 7 * 24 * 60 * 60 * 1000);
    const priorCycle = await prisma.binaryCycle.create({
      data: {
        userId: sponsor.id,
        weekStart: priorWeekStart,
        weekEnd: new Date(priorWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000 + 86399999),
        leftVolume: "4000",
        rightVolume: "0",
        matchedVolume: "0",
        commissionPaid: "0",
        carryLeft: "4000",
        carryRight: "0",
        carryLeftSince: almostStaleSince,
        carryRightSince: null,
        qualified: true,
        idempotencyKey: `binary:${sponsor.id}:${priorWeekStart.toISOString()}`,
      },
    });
    createdCycleIds.push(priorCycle.id);

    await seedBvEntry(sponsor.id, leftInvestment.id, "LEFT", "100", WEEK_START);
    await seedBvEntry(sponsor.id, rightInvestment.id, "RIGHT", "100", WEEK_START);

    const cycle = await closeBinaryCycleForUser(sponsor.id, WEEK_START, WEEK_END);
    createdCycleIds.push(cycle.id);

    // left = 4000 (carry-in SURVIVES, not yet expired) + 100 fresh = 4100.
    expect(new Prisma.Decimal(cycle.leftVolume).toString()).toBe("4100");
    expect(new Prisma.Decimal(cycle.rightVolume).toString()).toBe("100");
    expect(new Prisma.Decimal(cycle.matchedVolume).toString()).toBe("100");
    // Weaker (right) side clears; leftover 4000 on left carries on,
    // original since preserved (still counting from the same start).
    expect(new Prisma.Decimal(cycle.carryLeft).toString()).toBe("4000");
    expect(cycle.carryLeftSince?.toISOString()).toBe(almostStaleSince.toISOString());
  });

  it("preserves the original carryLeftSince across MULTIPLE consecutive partial-match cycles, never resetting until the side actually clears to 0", async () => {
    const { sponsor, leftInvestment, rightInvestment } = await makeQualifiedSponsor("expiry-multi-partial");
    const originalSince = new Date("2026-06-01T20:00:00.000Z"); // well within the 6-month window relative to WEEK_START

    const cycle1WeekStart = new Date(WEEK_START.getTime() - 14 * 24 * 60 * 60 * 1000);
    const seedCycle = await prisma.binaryCycle.create({
      data: {
        userId: sponsor.id,
        weekStart: cycle1WeekStart,
        weekEnd: new Date(cycle1WeekStart.getTime() + 6 * 24 * 60 * 60 * 1000 + 86399999),
        leftVolume: "10000",
        rightVolume: "0",
        matchedVolume: "0",
        commissionPaid: "0",
        carryLeft: "10000",
        carryRight: "0",
        carryLeftSince: originalSince,
        carryRightSince: null,
        qualified: true,
        idempotencyKey: `binary:${sponsor.id}:${cycle1WeekStart.toISOString()}`,
      },
    });
    createdCycleIds.push(seedCycle.id);

    // Cycle 2: a small RIGHT-side match partially reduces the LEFT carry,
    // but LEFT never reaches 0 -- since must stay pinned to originalSince.
    const cycle2WeekStart = new Date(WEEK_START.getTime() - 7 * 24 * 60 * 60 * 1000);
    const cycle2WeekEnd = new Date(cycle2WeekStart.getTime() + 6 * 24 * 60 * 60 * 1000 + 86399999);
    await seedBvEntry(sponsor.id, rightInvestment.id, "RIGHT", "1000", cycle2WeekStart);
    const cycle2 = await closeBinaryCycleForUser(sponsor.id, cycle2WeekStart, cycle2WeekEnd);
    createdCycleIds.push(cycle2.id);

    expect(new Prisma.Decimal(cycle2.carryLeft).toString()).toBe("9000"); // 10000 - 1000 matched
    expect(cycle2.carryLeftSince?.toISOString()).toBe(originalSince.toISOString());

    // Cycle 3 (this test's own WEEK_START): another small RIGHT-side match,
    // LEFT still doesn't clear -- since must STILL be the original, not
    // cycle 2's week_start. A second, distinct investment is needed since
    // bv_entries is UNIQUE(ancestorUserId, sourceInvestmentId) -- reusing
    // rightInvestment.id for a second week's entry would collide.
    const rightInvestment2 = await makeActiveInvestment(sponsor.id, "1");
    await seedBvEntry(sponsor.id, rightInvestment2.id, "RIGHT", "500", WEEK_START);
    void leftInvestment;

    const cycle3 = await closeBinaryCycleForUser(sponsor.id, WEEK_START, WEEK_END);
    createdCycleIds.push(cycle3.id);

    expect(new Prisma.Decimal(cycle3.carryLeft).toString()).toBe("8500"); // 9000 - 500 matched
    expect(cycle3.carryLeftSince?.toISOString()).toBe(originalSince.toISOString());
  });

  it("resets the expiry clock when a carry fully matches down to 0 in an intermediate week", async () => {
    const { sponsor, leftInvestment, rightInvestment } = await makeQualifiedSponsor("expiry-reset");

    const oldSince = new Date("2020-01-01T00:00:00.000Z"); // ancient, would be expired if it survived
    const priorWeekStart = new Date(WEEK_START.getTime() - 7 * 24 * 60 * 60 * 1000);
    const priorCycle = await prisma.binaryCycle.create({
      data: {
        userId: sponsor.id,
        weekStart: priorWeekStart,
        weekEnd: new Date(priorWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000 + 86399999),
        leftVolume: "1000",
        rightVolume: "1000",
        matchedVolume: "1000",
        commissionPaid: "80",
        // Fully matched last week -> carry is 0, since is null (the streak already ended).
        carryLeft: "0",
        carryRight: "0",
        carryLeftSince: null,
        carryRightSince: null,
        qualified: true,
        idempotencyKey: `binary:${sponsor.id}:${priorWeekStart.toISOString()}`,
      },
    });
    createdCycleIds.push(priorCycle.id);
    void oldSince; // not directly used (this scenario is deliberately null->fresh), kept for narrative clarity

    // This week: only LEFT gets fresh BV, so it starts a brand-new unmatched carry.
    await seedBvEntry(sponsor.id, leftInvestment.id, "LEFT", "2000", WEEK_START);
    void rightInvestment;

    const cycle = await closeBinaryCycleForUser(sponsor.id, WEEK_START, WEEK_END);
    createdCycleIds.push(cycle.id);

    expect(new Prisma.Decimal(cycle.carryLeft).toString()).toBe("2000");
    // Freshly started this cycle (prior since was null), not inherited from
    // any earlier, older streak.
    expect(cycle.carryLeftSince?.toISOString()).toBe(WEEK_START.toISOString());
  });

  it("is idempotent: closing the same (userId, weekStart) twice returns the same row and creates no duplicate ledger entries", async () => {
    const { sponsor, leftInvestment, rightInvestment } = await makeQualifiedSponsor("idempotent");

    await seedBvEntry(sponsor.id, leftInvestment.id, "LEFT", "1000", WEEK_START);
    await seedBvEntry(sponsor.id, rightInvestment.id, "RIGHT", "1000", WEEK_START);

    const first = await closeBinaryCycleForUser(sponsor.id, WEEK_START, WEEK_END);
    createdCycleIds.push(first.id);

    const second = await closeBinaryCycleForUser(sponsor.id, WEEK_START, WEEK_END);
    expect(second.id).toBe(first.id);
    expect(new Prisma.Decimal(second.commissionPaid).toString()).toBe(new Prisma.Decimal(first.commissionPaid).toString());

    const cycleCount = await prisma.binaryCycle.count({ where: { userId: sponsor.id, weekStart: WEEK_START } });
    expect(cycleCount).toBe(1);

    const ledgerCount = await prisma.ledgerEntry.count({
      where: { userId: sponsor.id, entryType: "BINARY_COMMISSION" },
    });
    expect(ledgerCount).toBe(1); // one CREDIT row (the paired SYSTEM_EXTERNAL DEBIT is userId: null, not counted here)
  });

  it("treats a user's first-ever cycle (no prior binary_cycles row) as carry-in 0/0 without crashing", async () => {
    const { sponsor, leftInvestment, rightInvestment } = await makeQualifiedSponsor("first-ever");

    await seedBvEntry(sponsor.id, leftInvestment.id, "LEFT", "2000", WEEK_START);
    await seedBvEntry(sponsor.id, rightInvestment.id, "RIGHT", "500", WEEK_START);

    const cycle = await closeBinaryCycleForUser(sponsor.id, WEEK_START, WEEK_END);
    createdCycleIds.push(cycle.id);

    expect(new Prisma.Decimal(cycle.leftVolume).toString()).toBe("2000");
    expect(new Prisma.Decimal(cycle.rightVolume).toString()).toBe("500");
    expect(new Prisma.Decimal(cycle.matchedVolume).toString()).toBe("500");
    expect(new Prisma.Decimal(cycle.carryLeft).toString()).toBe("1500");
  });

  it("a suspended user's own cycle is unqualified even with two active legs and their own active investment (confirmed with user: build_plan.md's cross-cutting suspended-party skip applies here too)", async () => {
    const { sponsor, leftInvestment, rightInvestment } = await makeQualifiedSponsor("suspended-self");

    await seedBvEntry(sponsor.id, leftInvestment.id, "LEFT", "1000", WEEK_START);
    await seedBvEntry(sponsor.id, rightInvestment.id, "RIGHT", "1000", WEEK_START);

    const mainAdmin = await prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
    await suspendUser(mainAdmin.id, sponsor.id, { reason: "Test." }, WEEK_START);

    const cycle = await closeBinaryCycleForUser(sponsor.id, WEEK_START, WEEK_END);
    createdCycleIds.push(cycle.id);

    // Both legs are still genuinely active (leg activity is about the
    // SUBTREE, unaffected by the sponsor's own suspension) — but the
    // sponsor's own suspendedAt blocks qualification directly, same as
    // every other commission engine in this codebase.
    expect(cycle.qualified).toBe(false);
    expect(cycle.qualificationReason).toBe("account_suspended");
    expect(new Prisma.Decimal(cycle.commissionPaid).toString()).toBe("0");
    // Volume still carries forward in full even though unqualified.
    expect(new Prisma.Decimal(cycle.carryLeft).toString()).toBe("1000");
    expect(new Prisma.Decimal(cycle.carryRight).toString()).toBe("1000");

    const ledgerCount = await prisma.ledgerEntry.count({
      where: { userId: sponsor.id, entryType: "BINARY_COMMISSION" },
    });
    expect(ledgerCount).toBe(0);
  });
});
