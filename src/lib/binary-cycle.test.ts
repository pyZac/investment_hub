import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { saturdayWeekStart, isLegActive } from "./binary-cycle";
import { registerAsRoot, registerWithSponsor, suspendUser, reinstateUser } from "./users";
import { purchasePackage } from "./investments";
import { adminCreditWalletB } from "./admin-credit";
import { releaseCapital } from "./capital-release";
import { postTransaction } from "./ledger-transaction";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

describe("saturdayWeekStart", () => {
  it("returns the same instant for a Saturday 00:00 Dubai input", () => {
    // 2026-08-22 is a Saturday. Midnight Dubai (UTC+4) is 2026-08-21T20:00:00Z.
    const saturdayMidnightDubai = new Date("2026-08-21T20:00:00.000Z");
    const result = saturdayWeekStart(saturdayMidnightDubai);
    expect(result.toISOString()).toBe("2026-08-21T20:00:00.000Z");
  });

  it("walks back to the prior Saturday for a mid-week date", () => {
    // 2026-08-25 is a Tuesday, same week as the 2026-08-22 Saturday.
    const tuesday = new Date("2026-08-25T10:00:00.000Z");
    const result = saturdayWeekStart(tuesday);
    expect(result.toISOString()).toBe("2026-08-21T20:00:00.000Z");
  });

  it("walks back to the prior Saturday for a Friday (end of that week's cycle)", () => {
    // 2026-08-28 is a Friday, closing the week that started Saturday 2026-08-22.
    const friday = new Date("2026-08-28T15:00:00.000Z");
    const result = saturdayWeekStart(friday);
    expect(result.toISOString()).toBe("2026-08-21T20:00:00.000Z");
  });

  it("handles the UTC/Dubai boundary correctly (UTC-Friday-but-Dubai-Saturday)", () => {
    // 2026-08-21T21:00:00Z is Friday 21:00 UTC, but 2026-08-22 01:00 in
    // Dubai (UTC+4) — already Saturday there, so it should be its own
    // week's start, not walk back to the prior week.
    const utcFridayDubaiSaturday = new Date("2026-08-21T21:00:00.000Z");
    const result = saturdayWeekStart(utcFridayDubaiSaturday);
    expect(result.toISOString()).toBe("2026-08-21T20:00:00.000Z");
  });
});

describe("isLegActive", () => {
  const createdUserIds: string[] = [];
  const createdPackageIds: string[] = [];
  const createdInvestmentIds: string[] = [];
  const checkDate = new Date("2026-08-24T10:00:00.000Z");

  const sampleQuestions = [
    { question: "First pet's name?", answer: "Fluffy" },
    { question: "Mother's maiden name?", answer: "Smith" },
    { question: "First school?", answer: "Oakwood" },
  ];

  afterAll(async () => {
    await prisma.bvEntry.deleteMany({ where: { ancestorUserId: { in: createdUserIds } } });
    await prisma.savingLot.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
    await cleanupLedgerEntriesForUsers(createdUserIds);
    await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
    await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.binaryNode.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  async function makeRoot(label: string) {
    const user = await registerAsRoot({
      email: `legactive-${label}-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: label,
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function makeReferral(sponsorId: string, label: string) {
    const user = await registerWithSponsor(sponsorId, {
      email: `legactive-${label}-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: label,
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function makeAndFundPackage(amount: string) {
    const pkg = await prisma.package.create({
      data: { name: `LegActiveTest-${crypto.randomUUID()}`, amount, isActive: true },
    });
    createdPackageIds.push(pkg.id);
    return pkg;
  }

  async function fundWalletB(userId: string, amount: string) {
    const mainAdmin = await prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
    await adminCreditWalletB(mainAdmin.id, {
      userId,
      amount,
      reason: "Test funding for leg activity check.",
      idempotencyKey: `legactive-fund:${userId}:${crypto.randomUUID()}`,
    });
  }

  /** Buys a package for `userId`, funding Wallet B first. Returns the investment. */
  async function purchaseFor(userId: string, amount: string) {
    await fundWalletB(userId, amount);
    const pkg = await makeAndFundPackage(amount);
    const result = await purchasePackage(userId, {
      packageId: pkg.id,
      forDate: checkDate,
      idempotencyKey: `legactive-purchase:${userId}:${crypto.randomUUID()}`,
    });
    createdInvestmentIds.push(result.investment.id);
    return result.investment;
  }

  it("is active when an active investment sits deep in the subtree, not just a direct child", async () => {
    // sponsor -> mid (sponsor's LEFT) -> deep (mid's LEFT) -- deep holds the capital
    const sponsor = await makeRoot("deep-sponsor");
    const mid = await makeReferral(sponsor.id, "deep-mid"); // sponsor's LEFT
    await makeReferral(sponsor.id, "deep-filler"); // sponsor's RIGHT (so LEFT isn't the only leg)
    const deep = await makeReferral(mid.id, "deep-leaf"); // mid's LEFT

    await purchaseFor(deep.id, "1000");

    expect(await isLegActive(sponsor.id, "LEFT", checkDate)).toBe(true);
  });

  it("is inactive once the sole capital-holder has released their capital", async () => {
    const sponsor = await makeRoot("released-sponsor");
    const leaf = await makeReferral(sponsor.id, "released-leaf"); // sponsor's LEFT
    await makeReferral(sponsor.id, "released-filler"); // sponsor's RIGHT

    const investment = await purchaseFor(leaf.id, "1000");
    expect(await isLegActive(sponsor.id, "LEFT", checkDate)).toBe(true);

    await prisma.investment.update({
      where: { id: investment.id },
      data: { status: "CAPITAL_RELEASED", capitalReleasedAt: checkDate },
    });

    expect(await isLegActive(sponsor.id, "LEFT", checkDate)).toBe(false);
  });

  it("is inactive when the sole capital-holder is suspended", async () => {
    const sponsor = await makeRoot("suspended-sponsor");
    const leaf = await makeReferral(sponsor.id, "suspended-leaf"); // sponsor's LEFT
    await makeReferral(sponsor.id, "suspended-filler"); // sponsor's RIGHT

    await purchaseFor(leaf.id, "1000");
    expect(await isLegActive(sponsor.id, "LEFT", checkDate)).toBe(true);

    await prisma.user.update({ where: { id: leaf.id }, data: { suspendedAt: checkDate } });

    expect(await isLegActive(sponsor.id, "LEFT", checkDate)).toBe(false);
  });

  it("is inactive for an empty leg with no members at all", async () => {
    const sponsor = await makeRoot("empty-sponsor");
    // Only fill RIGHT — LEFT has no direct child, so its subtree is empty.
    await makeReferral(sponsor.id, "empty-filler-right-1");

    expect(await isLegActive(sponsor.id, "LEFT", checkDate)).toBe(false);
  });

  it("is active when the leg's only member is a direct child (no grandchildren) holding active capital", async () => {
    // sponsor -> onlyChild (sponsor's LEFT), nobody below onlyChild at all.
    // Exercises the path-prefix match against the leg root's OWN row, not
    // just descendants below it — a one-person leg must still match.
    const sponsor = await makeRoot("solo-sponsor");
    const onlyChild = await makeReferral(sponsor.id, "solo-child"); // sponsor's LEFT
    await makeReferral(sponsor.id, "solo-filler"); // sponsor's RIGHT

    await purchaseFor(onlyChild.id, "1000");

    expect(await isLegActive(sponsor.id, "LEFT", checkDate)).toBe(true);
  });

  it("is active when multiple members exist in the leg but only one holds active capital", async () => {
    const sponsor = await makeRoot("multi-sponsor");
    const mid = await makeReferral(sponsor.id, "multi-mid"); // sponsor's LEFT
    await makeReferral(sponsor.id, "multi-filler"); // sponsor's RIGHT
    const nonBuyingSibling = await makeReferral(mid.id, "multi-non-buyer"); // mid's LEFT, never purchases
    const buyer = await makeReferral(mid.id, "multi-buyer"); // mid's RIGHT
    void nonBuyingSibling;

    await purchaseFor(buyer.id, "1000");

    expect(await isLegActive(sponsor.id, "LEFT", checkDate)).toBe(true);
  });
});

describe("leg-activity ripple on capital release / suspension (SCRUM-77)", () => {
  const createdUserIds: string[] = [];
  const createdPackageIds: string[] = [];
  const createdInvestmentIds: string[] = [];
  // 2026-08-21 is a Friday (Asia/Dubai noon).
  const FRIDAY = new Date("2026-08-21T12:00:00.000Z");

  const sampleQuestions = [
    { question: "First pet's name?", answer: "Fluffy" },
    { question: "Mother's maiden name?", answer: "Smith" },
    { question: "First school?", answer: "Oakwood" },
  ];

  afterAll(async () => {
    await prisma.adminAction.deleteMany({ where: { targetUserId: { in: createdUserIds } } });
    await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
    await cleanupLedgerEntriesForUsers(createdUserIds);
    await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
    await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.binaryNode.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  async function makeRoot(label: string) {
    const user = await registerAsRoot({
      email: `ripple-${label}-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: label,
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function makeReferral(sponsorId: string, label: string) {
    const user = await registerWithSponsor(sponsorId, {
      email: `ripple-${label}-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: label,
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);
    return user;
  }

  /**
   * Creates an ACTIVE investment directly (bypassing purchasePackage) so its
   * capitalUnlocksAt can be pinned to exactly FRIDAY, matching
   * capital-release.test.ts's own pattern for exercising the real
   * releaseCapital function without waiting out a real 6-month lock.
   */
  async function makeReleasableInvestment(userId: string, amount: string) {
    const pkg = await prisma.package.create({
      data: { name: `RippleTest-${crypto.randomUUID()}`, amount, isActive: true },
    });
    createdPackageIds.push(pkg.id);

    const investment = await prisma.investment.create({
      data: {
        userId,
        packageId: pkg.id,
        amount,
        purchasedAt: new Date("2026-01-01T00:00:00.000Z"),
        profitStartsAt: new Date("2026-01-08T00:00:00.000Z"),
        capitalUnlocksAt: FRIDAY,
        referenceId: `ripple-seed:${crypto.randomUUID()}`,
      },
    });
    createdInvestmentIds.push(investment.id);
    return investment;
  }

  async function fundWalletA(userId: string, amount: string) {
    await postTransaction({
      entries: [
        { userId, wallet: "A", direction: "CREDIT", amount, entryType: "ADMIN_CREDIT", comment: "Ripple test funding." },
        { userId: null, wallet: "SYSTEM_EXTERNAL", direction: "DEBIT", amount, entryType: "ADMIN_CREDIT", comment: "Ripple test funding." },
      ],
      idempotencyKey: `ripple-fund:${userId}:${crypto.randomUUID()}`,
    });
  }

  it("capital release on a deep leaf flips BOTH the immediate parent's AND a further ancestor's leg to inactive", async () => {
    // grandAncestor -> ancestor (grandAncestor's LEFT) -> leaf (ancestor's LEFT)
    const grandAncestor = await makeRoot("grand");
    const ancestor = await makeReferral(grandAncestor.id, "mid"); // grandAncestor's LEFT
    await makeReferral(grandAncestor.id, "grand-filler"); // grandAncestor's RIGHT
    const leaf = await makeReferral(ancestor.id, "leaf"); // ancestor's LEFT
    await makeReferral(ancestor.id, "mid-filler"); // ancestor's RIGHT

    const investment = await makeReleasableInvestment(leaf.id, "1000");
    await fundWalletA(leaf.id, "1000");

    // Before release: both ancestor's and grandAncestor's LEFT legs are active.
    expect(await isLegActive(ancestor.id, "LEFT", FRIDAY)).toBe(true);
    expect(await isLegActive(grandAncestor.id, "LEFT", FRIDAY)).toBe(true);

    await releaseCapital(leaf.id, investment.id, FRIDAY);

    // After release: leaf no longer holds ACTIVE capital, and leaf was the
    // ONLY active member in either leg — both ancestors' LEFT legs must flip,
    // not just the immediate parent.
    expect(await isLegActive(ancestor.id, "LEFT", FRIDAY)).toBe(false);
    expect(await isLegActive(grandAncestor.id, "LEFT", FRIDAY)).toBe(false);
  });

  it("suspending a deep leaf flips both ancestors' legs inactive; reinstating flips them back active", async () => {
    const grandAncestor = await makeRoot("susp-grand");
    const ancestor = await makeReferral(grandAncestor.id, "susp-mid");
    await makeReferral(grandAncestor.id, "susp-grand-filler");
    const leaf = await makeReferral(ancestor.id, "susp-leaf");
    await makeReferral(ancestor.id, "susp-mid-filler");

    await makeReleasableInvestment(leaf.id, "1000");
    await fundWalletA(leaf.id, "1000");

    expect(await isLegActive(ancestor.id, "LEFT", FRIDAY)).toBe(true);
    expect(await isLegActive(grandAncestor.id, "LEFT", FRIDAY)).toBe(true);

    const mainAdmin = await prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
    await suspendUser(mainAdmin.id, leaf.id, { reason: "Ripple test suspension." }, FRIDAY);

    expect(await isLegActive(ancestor.id, "LEFT", FRIDAY)).toBe(false);
    expect(await isLegActive(grandAncestor.id, "LEFT", FRIDAY)).toBe(false);

    await reinstateUser(mainAdmin.id, leaf.id, { reason: "Ripple test reinstatement." });

    expect(await isLegActive(ancestor.id, "LEFT", FRIDAY)).toBe(true);
    expect(await isLegActive(grandAncestor.id, "LEFT", FRIDAY)).toBe(true);
  });
});
