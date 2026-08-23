import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import {
  registerAsRoot,
  registerWithSponsor,
  adminCreateUser,
  listReferralsForUser,
  suspendUser,
  reinstateUser,
  CannotSuspendMainAdminError,
} from "./users";
import { adminCreditWalletB } from "./admin-credit";
import { purchasePackage } from "./investments";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
const createdInvestmentIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeAdmin() {
  const admin = await prisma.user.create({
    data: {
      email: `admin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test Admin",
      role: "ADMIN",
    },
  });
  createdUserIds.push(admin.id);
  return admin;
}

async function getMainAdmin() {
  const admin = await prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
  return admin;
}

afterAll(async () => {
  await prisma.adminAction.deleteMany({
    where: { OR: [{ targetUserId: { in: createdUserIds } }, { adminId: { in: createdUserIds } }] },
  });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
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

describe("registerAsRoot", () => {
  it("creates a user with no sponsor", async () => {
    const user = await registerAsRoot({
      email: `root-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Root User",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);

    expect(user.sponsorId).toBeNull();
    expect(user.role).toBe("USER");

    const questions = await prisma.securityQuestion.findMany({ where: { userId: user.id } });
    expect(questions).toHaveLength(3);
  });
});

describe("registerWithSponsor", () => {
  let sponsor: Awaited<ReturnType<typeof registerAsRoot>>;

  beforeAll(async () => {
    sponsor = await registerAsRoot({
      email: `sponsor-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Sponsor User",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(sponsor.id);
  });

  it("places the new user under the sponsor", async () => {
    const user = await registerWithSponsor(sponsor.id, {
      email: `referred-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Referred User",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);

    expect(user.sponsorId).toBe(sponsor.id);
  });

  it("rejects an unknown sponsor id", async () => {
    await expect(
      registerWithSponsor("nonexistent-id", {
        email: `orphan-${crypto.randomUUID()}@test.local`,
        password: "password123",
        name: "Orphan",
        securityQuestions: sampleQuestions,
      }),
    ).rejects.toThrow(/sponsor not found/i);
  });

  it("rejects a suspended sponsor", async () => {
    const suspended = await registerAsRoot({
      email: `suspended-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Suspended Sponsor",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(suspended.id);
    await prisma.user.update({ where: { id: suspended.id }, data: { suspendedAt: new Date() } });

    await expect(
      registerWithSponsor(suspended.id, {
        email: `blocked-${crypto.randomUUID()}@test.local`,
        password: "password123",
        name: "Blocked",
        securityQuestions: sampleQuestions,
      }),
    ).rejects.toThrow(/suspended/i);
  });
});

describe("adminCreateUser", () => {
  it("main admin can create a user and it logs to admin_actions", async () => {
    const mainAdmin = await getMainAdmin();

    const user = await adminCreateUser(mainAdmin.id, {
      email: `admincreated-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Admin Created",
      reason: "Manual onboarding for a walk-in client.",
    });
    createdUserIds.push(user.id);

    expect(user.createdByAdminId).toBe(mainAdmin.id);

    const action = await prisma.adminAction.findFirst({
      where: { targetUserId: user.id, actionType: "USER_CREATED" },
    });
    expect(action).not.toBeNull();
    expect(action?.adminId).toBe(mainAdmin.id);
    expect(action?.reason).toMatch(/walk-in/);
  });

  it("rejects a sub-admin without USER_MANAGEMENT", async () => {
    const subAdmin = await makeAdmin();

    await expect(
      adminCreateUser(subAdmin.id, {
        email: `denied-${crypto.randomUUID()}@test.local`,
        password: "password123",
        name: "Denied",
        reason: "Should not be allowed.",
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("allows a sub-admin with USER_MANAGEMENT", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "USER_MANAGEMENT" },
    });

    const user = await adminCreateUser(subAdmin.id, {
      email: `granted-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Granted",
      reason: "Sub-admin onboarding.",
    });
    createdUserIds.push(user.id);

    expect(user.createdByAdminId).toBe(subAdmin.id);
  });

  it("rejects an empty reason", async () => {
    const mainAdmin = await getMainAdmin();

    await expect(
      adminCreateUser(mainAdmin.id, {
        email: `noreason-${crypto.randomUUID()}@test.local`,
        password: "password123",
        name: "No Reason",
        reason: "",
      }),
    ).rejects.toThrow();
  });
});

describe("listReferralsForUser", () => {
  async function getMainAdminForFunding() {
    return prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
  }

  it("returns only the given user's direct referrals, newest first, excluding non-referrals", async () => {
    const sponsor = await registerAsRoot({
      email: `list-sponsor-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "List Sponsor",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(sponsor.id);

    const referral1 = await registerWithSponsor(sponsor.id, {
      email: `list-ref1-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Referral One",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(referral1.id);

    const referral2 = await registerWithSponsor(sponsor.id, {
      email: `list-ref2-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Referral Two",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(referral2.id);

    // A root user with no sponsor must never appear in anyone's referral list.
    const unrelated = await registerAsRoot({
      email: `list-unrelated-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Unrelated Root",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(unrelated.id);

    const referrals = await listReferralsForUser(sponsor.id);

    expect(referrals).toHaveLength(2);
    expect(referrals[0].id).toBe(referral2.id);
    expect(referrals[1].id).toBe(referral1.id);
    expect(referrals.some((r) => r.id === unrelated.id)).toBe(false);
  });

  it("returns an empty array for a user with no referrals", async () => {
    const user = await registerAsRoot({
      email: `list-none-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "No Referrals",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);

    const referrals = await listReferralsForUser(user.id);
    expect(referrals).toEqual([]);
  });

  it("reports whether each referral has made at least one purchase", async () => {
    const sponsor = await registerAsRoot({
      email: `list-purchase-sponsor-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Purchase Sponsor",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(sponsor.id);

    const buyer = await registerWithSponsor(sponsor.id, {
      email: `list-buyer-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Buyer Referral",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(buyer.id);

    const nonBuyer = await registerWithSponsor(sponsor.id, {
      email: `list-nonbuyer-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Non-buyer Referral",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(nonBuyer.id);

    const mainAdmin = await getMainAdminForFunding();
    await adminCreditWalletB(mainAdmin.id, {
      userId: buyer.id,
      amount: "1000",
      reason: "Test funding.",
      idempotencyKey: `fund:${buyer.id}:${crypto.randomUUID()}`,
    });
    const pkg = await prisma.package.create({
      data: { name: `Test-${crypto.randomUUID()}`, amount: "1000", isActive: true },
    });
    createdPackageIds.push(pkg.id);
    const purchaseResult = await purchasePackage(buyer.id, {
      packageId: pkg.id,
      forDate: new Date("2026-08-01T10:00:00.000Z"),
      idempotencyKey: `purchase:${buyer.id}:${crypto.randomUUID()}`,
    });
    createdInvestmentIds.push(purchaseResult.investment.id);

    const referrals = await listReferralsForUser(sponsor.id);
    const buyerRow = referrals.find((r) => r.id === buyer.id)!;
    const nonBuyerRow = referrals.find((r) => r.id === nonBuyer.id)!;

    expect(buyerRow.hasPurchased).toBe(true);
    expect(nonBuyerRow.hasPurchased).toBe(false);
  });

  it("reflects a suspended referral's status", async () => {
    const sponsor = await registerAsRoot({
      email: `list-susp-sponsor-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Suspend Sponsor",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(sponsor.id);

    const referral = await registerWithSponsor(sponsor.id, {
      email: `list-susp-ref-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Suspended Referral",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(referral.id);
    await prisma.user.update({ where: { id: referral.id }, data: { suspendedAt: new Date() } });

    const referrals = await listReferralsForUser(sponsor.id);
    expect(referrals[0].suspendedAt).not.toBeNull();
  });
});

describe("suspendUser / reinstateUser", () => {
  const forDate = new Date("2026-08-22T10:00:00.000Z");

  async function makeTarget(label: string) {
    const user = await registerAsRoot({
      email: `suspend-${label}-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: label,
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);
    return user;
  }

  it("main admin can suspend and then reinstate a user, logging both admin_actions", async () => {
    const mainAdmin = await getMainAdmin();
    const target = await makeTarget("main-admin-flow");

    const suspended = await suspendUser(mainAdmin.id, target.id, { reason: "Fraud review." }, forDate);
    expect(suspended.suspendedAt?.toISOString()).toBe(forDate.toISOString());

    const suspendAction = await prisma.adminAction.findFirstOrThrow({
      where: { targetUserId: target.id, actionType: "USER_SUSPENDED" },
    });
    expect(suspendAction.adminId).toBe(mainAdmin.id);
    expect(suspendAction.reason).toBe("Fraud review.");

    const reinstated = await reinstateUser(mainAdmin.id, target.id, { reason: "Review cleared." });
    expect(reinstated.suspendedAt).toBeNull();

    const reinstateAction = await prisma.adminAction.findFirstOrThrow({
      where: { targetUserId: target.id, actionType: "USER_REINSTATED" },
    });
    expect(reinstateAction.reason).toBe("Review cleared.");
  });

  it("allows a sub-admin with USER_MANAGEMENT", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "USER_MANAGEMENT" },
    });
    const target = await makeTarget("granted-sub-admin");

    const suspended = await suspendUser(subAdmin.id, target.id, { reason: "Test." }, forDate);
    expect(suspended.suspendedAt).not.toBeNull();
  });

  it("rejects a sub-admin without USER_MANAGEMENT", async () => {
    const subAdmin = await makeAdmin();
    const target = await makeTarget("ungranted-sub-admin");

    await expect(suspendUser(subAdmin.id, target.id, { reason: "Test." }, forDate)).rejects.toThrow(/forbidden/i);
  });

  it("rejects a non-admin acting user", async () => {
    const nonAdmin = await makeTarget("non-admin-actor");
    const target = await makeTarget("non-admin-target");

    await expect(suspendUser(nonAdmin.id, target.id, { reason: "Test." }, forDate)).rejects.toThrow(/forbidden/i);
  });

  it("suspending an already-suspended user is a no-op, not an error", async () => {
    const mainAdmin = await getMainAdmin();
    const target = await makeTarget("double-suspend");

    await suspendUser(mainAdmin.id, target.id, { reason: "First." }, forDate);
    const actionCountAfterFirst = await prisma.adminAction.count({
      where: { targetUserId: target.id, actionType: "USER_SUSPENDED" },
    });

    const secondResult = await suspendUser(mainAdmin.id, target.id, { reason: "Second." }, forDate);
    expect(secondResult.suspendedAt?.toISOString()).toBe(forDate.toISOString());

    const actionCountAfterSecond = await prisma.adminAction.count({
      where: { targetUserId: target.id, actionType: "USER_SUSPENDED" },
    });
    expect(actionCountAfterSecond).toBe(actionCountAfterFirst); // no duplicate log entry
  });

  it("reinstating an already-active user is a no-op, not an error", async () => {
    const mainAdmin = await getMainAdmin();
    const target = await makeTarget("noop-reinstate");

    const result = await reinstateUser(mainAdmin.id, target.id, { reason: "Never suspended." });
    expect(result.suspendedAt).toBeNull();

    const reinstateActionCount = await prisma.adminAction.count({
      where: { targetUserId: target.id, actionType: "USER_REINSTATED" },
    });
    expect(reinstateActionCount).toBe(0); // no-op, no log entry for a state that never changed
  });

  it("cannot suspend the main admin", async () => {
    const mainAdmin = await getMainAdmin();

    await expect(suspendUser(mainAdmin.id, mainAdmin.id, { reason: "Test." }, forDate)).rejects.toThrow(
      CannotSuspendMainAdminError,
    );
  });
});
