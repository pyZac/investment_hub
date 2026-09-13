import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import {
  PACKAGE_TIERS,
  seedPackageTiers,
  createPackage,
  editPackage,
  deactivatePackage,
  reactivatePackage,
  listPurchasablePackages,
  listAllPackages,
  PackageHasInvestmentsError,
} from "./packages";
import { registerAsRoot } from "./users";
import { purchasePackage } from "./investments";
import { postTransaction } from "./ledger-transaction";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";
import { hashToken } from "./token-hash";
import { requirePermission } from "./route-guard";

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
      email: `pkg-admin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test Admin",
      role: "ADMIN",
    },
  });
  createdUserIds.push(admin.id);
  return admin;
}

async function makeUser() {
  const user = await prisma.user.create({
    data: {
      email: `pkg-user-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test User",
      role: "USER",
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function getMainAdmin() {
  return prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
}

async function makePackage(name: string, amount: string) {
  const pkg = await prisma.package.create({ data: { name, amount } });
  createdPackageIds.push(pkg.id);
  return pkg;
}

async function makeSessionToken(userId: string, forDate: Date) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(forDate.getTime() + 60 * 60 * 1000),
      lastActiveAt: forDate,
    },
  });
  return token;
}

async function fundWalletB(userId: string, amount: string) {
  const idempotencyKey = `test-fund:B:${userId}:${crypto.randomUUID()}`;
  await postTransaction({
    entries: [
      { userId, wallet: "B", direction: "CREDIT", amount, entryType: "ADMIN_CREDIT", comment: "Test funding." },
      { userId: null, wallet: "SYSTEM_EXTERNAL", direction: "DEBIT", amount, entryType: "ADMIN_CREDIT", comment: "Test funding." },
    ],
    idempotencyKey,
  });
}

afterAll(async () => {
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.adminAction.deleteMany({
    where: {
      OR: [{ adminId: { in: createdUserIds } }, { targetPackageId: { in: createdPackageIds } }],
    },
  });
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("package tier seeding", () => {
  it("creates all 7 fixed tiers with correct amounts", async () => {
    await seedPackageTiers();

    for (const tier of PACKAGE_TIERS) {
      const row = await prisma.package.findUniqueOrThrow({ where: { name: tier.name } });
      expect(row.amount.toString()).toBe(tier.amount);
      expect(row.isActive).toBe(true);
      expect(row.deactivatedAt).toBeNull();
    }
  });

  it("is idempotent — running twice does not duplicate or error", async () => {
    await seedPackageTiers();
    await seedPackageTiers();

    const count = await prisma.package.count({
      where: { name: { in: PACKAGE_TIERS.map((t) => t.name) } },
    });
    expect(count).toBe(PACKAGE_TIERS.length);
  });
});

describe("createPackage", () => {
  it("main admin can create a package", async () => {
    const mainAdmin = await getMainAdmin();

    const pkg = await createPackage(mainAdmin.id, {
      name: `Custom-${crypto.randomUUID()}`,
      amount: "2500",
    });
    createdPackageIds.push(pkg.id);

    expect(pkg.amount.toString()).toBe("2500");
    expect(pkg.isActive).toBe(true);

    const action = await prisma.adminAction.findFirst({
      where: { targetPackageId: pkg.id, actionType: "PACKAGE_CREATED" },
    });
    expect(action).not.toBeNull();
    expect(action?.adminId).toBe(mainAdmin.id);
  });

  it("sub-admin with PACKAGE_MANAGEMENT can create a package", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "PACKAGE_MANAGEMENT" },
    });

    const pkg = await createPackage(subAdmin.id, {
      name: `Custom-${crypto.randomUUID()}`,
      amount: "3000",
    });
    createdPackageIds.push(pkg.id);

    expect(pkg.amount.toString()).toBe("3000");
  });

  it("sub-admin without PACKAGE_MANAGEMENT is rejected", async () => {
    const subAdmin = await makeAdmin();

    await expect(
      createPackage(subAdmin.id, { name: `Custom-${crypto.randomUUID()}`, amount: "1000" }),
    ).rejects.toThrow(/forbidden|PACKAGE_MANAGEMENT/i);
  });

  it("a non-admin is rejected", async () => {
    const user = await makeUser();

    await expect(
      createPackage(user.id, { name: `Custom-${crypto.randomUUID()}`, amount: "1000" }),
    ).rejects.toThrow(/forbidden/i);
  });
});

describe("editPackage", () => {
  it("main admin can edit name and amount", async () => {
    const mainAdmin = await getMainAdmin();
    const pkg = await makePackage(`Editable-${crypto.randomUUID()}`, "1000");

    const updated = await editPackage(mainAdmin.id, {
      packageId: pkg.id,
      name: `Renamed-${crypto.randomUUID()}`,
      amount: "1500",
    });

    expect(updated.amount.toString()).toBe("1500");

    const action = await prisma.adminAction.findFirst({
      where: { targetPackageId: pkg.id, actionType: "PACKAGE_EDITED" },
    });
    expect(action).not.toBeNull();
    expect(action?.adminId).toBe(mainAdmin.id);
  });

  it("editing does not touch isActive or deactivatedAt", async () => {
    const mainAdmin = await getMainAdmin();
    const pkg = await makePackage(`Editable-${crypto.randomUUID()}`, "1000");

    const updated = await editPackage(mainAdmin.id, { packageId: pkg.id, amount: "2000" });

    expect(updated.isActive).toBe(true);
    expect(updated.deactivatedAt).toBeNull();
  });

  it("sub-admin without PACKAGE_MANAGEMENT is rejected", async () => {
    const subAdmin = await makeAdmin();
    const pkg = await makePackage(`Editable-${crypto.randomUUID()}`, "1000");

    await expect(
      editPackage(subAdmin.id, { packageId: pkg.id, amount: "9999" }),
    ).rejects.toThrow(/forbidden|PACKAGE_MANAGEMENT/i);

    const unchanged = await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(unchanged.amount.toString()).toBe("1000");
  });

  it("refuses to edit a package that has an existing investment (any status, not just ACTIVE)", async () => {
    const mainAdmin = await getMainAdmin();
    const pkg = await makePackage(`HasInvestment-${crypto.randomUUID()}`, "1000");
    const buyer = await registerAsRoot({
      email: `pkg-buyer-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Package Buyer",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(buyer.id);
    await fundWalletB(buyer.id, "1000");

    const purchaseResult = await purchasePackage(buyer.id, {
      packageId: pkg.id,
      forDate: new Date("2026-08-01T10:00:00.000Z"),
      idempotencyKey: `pkg-test-purchase:${buyer.id}:${crypto.randomUUID()}`,
    });
    createdInvestmentIds.push(purchaseResult.investment.id);

    await expect(
      editPackage(mainAdmin.id, { packageId: pkg.id, name: `ShouldNotRename-${crypto.randomUUID()}` }),
    ).rejects.toThrow(PackageHasInvestmentsError);

    const unchanged = await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(unchanged.name).toBe(pkg.name);
    expect(unchanged.amount.toString()).toBe("1000");
  });

  it("still allows editing a package with zero investments (regression check against the new guard)", async () => {
    const mainAdmin = await getMainAdmin();
    const pkg = await makePackage(`NoInvestmentYet-${crypto.randomUUID()}`, "1000");

    const updated = await editPackage(mainAdmin.id, { packageId: pkg.id, amount: "1234" });
    expect(updated.amount.toString()).toBe("1234");
  });
});

describe("deactivatePackage", () => {
  it("main admin can deactivate a package", async () => {
    const mainAdmin = await getMainAdmin();
    const pkg = await makePackage(`Deactivatable-${crypto.randomUUID()}`, "1000");
    const now = new Date();

    const updated = await deactivatePackage(mainAdmin.id, { packageId: pkg.id, forDate: now });

    expect(updated.isActive).toBe(false);
    expect(updated.deactivatedAt?.getTime()).toBe(now.getTime());

    const action = await prisma.adminAction.findFirst({
      where: { targetPackageId: pkg.id, actionType: "PACKAGE_DEACTIVATED" },
    });
    expect(action).not.toBeNull();
  });

  it("does not alter the package's id, name, or amount", async () => {
    const mainAdmin = await getMainAdmin();
    const name = `Deactivatable-${crypto.randomUUID()}`;
    const pkg = await makePackage(name, "4242");

    const updated = await deactivatePackage(mainAdmin.id, { packageId: pkg.id, forDate: new Date() });

    expect(updated.id).toBe(pkg.id);
    expect(updated.name).toBe(name);
    expect(updated.amount.toString()).toBe("4242");
  });

  it("sub-admin without PACKAGE_MANAGEMENT is rejected", async () => {
    const subAdmin = await makeAdmin();
    const pkg = await makePackage(`Deactivatable-${crypto.randomUUID()}`, "1000");

    await expect(
      deactivatePackage(subAdmin.id, { packageId: pkg.id, forDate: new Date() }),
    ).rejects.toThrow(/forbidden|PACKAGE_MANAGEMENT/i);

    const unchanged = await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(unchanged.isActive).toBe(true);
  });

  it("does not affect the package's existing investments", async () => {
    const mainAdmin = await getMainAdmin();
    const pkg = await makePackage(`DeactivateKeepsInvestments-${crypto.randomUUID()}`, "1000");
    const buyer = await registerAsRoot({
      email: `pkg-deactivate-buyer-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Deactivate Buyer",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(buyer.id);
    await fundWalletB(buyer.id, "1000");

    const purchaseResult = await purchasePackage(buyer.id, {
      packageId: pkg.id,
      forDate: new Date("2026-08-01T10:00:00.000Z"),
      idempotencyKey: `pkg-test-deactivate-purchase:${buyer.id}:${crypto.randomUUID()}`,
    });
    createdInvestmentIds.push(purchaseResult.investment.id);
    const before = await prisma.investment.findUniqueOrThrow({ where: { id: purchaseResult.investment.id } });

    await deactivatePackage(mainAdmin.id, { packageId: pkg.id, forDate: new Date() });

    const after = await prisma.investment.findUniqueOrThrow({ where: { id: purchaseResult.investment.id } });
    expect(after.status).toBe(before.status);
    expect(after.amount.toString()).toBe(before.amount.toString());
    expect(after.purchasedAt.getTime()).toBe(before.purchasedAt.getTime());
    expect(after.profitStartsAt.getTime()).toBe(before.profitStartsAt.getTime());
    expect(after.capitalUnlocksAt.getTime()).toBe(before.capitalUnlocksAt.getTime());
    expect(after.packageId).toBe(pkg.id);
  });
});

describe("reactivatePackage", () => {
  it("main admin can reactivate a deactivated package, logging PACKAGE_REACTIVATED", async () => {
    const mainAdmin = await getMainAdmin();
    const pkg = await makePackage(`Reactivatable-${crypto.randomUUID()}`, "1000");
    await deactivatePackage(mainAdmin.id, { packageId: pkg.id, forDate: new Date() });

    const updated = await reactivatePackage(mainAdmin.id, { packageId: pkg.id });

    expect(updated.isActive).toBe(true);
    expect(updated.deactivatedAt).toBeNull();

    const action = await prisma.adminAction.findFirst({
      where: { targetPackageId: pkg.id, actionType: "PACKAGE_REACTIVATED" },
    });
    expect(action).not.toBeNull();
    expect(action?.adminId).toBe(mainAdmin.id);
  });

  it("throws if the package is already active", async () => {
    const mainAdmin = await getMainAdmin();
    const pkg = await makePackage(`AlreadyActive-${crypto.randomUUID()}`, "1000");

    await expect(reactivatePackage(mainAdmin.id, { packageId: pkg.id })).rejects.toThrow(/already active/i);
  });

  it("sub-admin without PACKAGE_MANAGEMENT is rejected", async () => {
    const subAdmin = await makeAdmin();
    const mainAdmin = await getMainAdmin();
    const pkg = await makePackage(`ReactivateDenied-${crypto.randomUUID()}`, "1000");
    await deactivatePackage(mainAdmin.id, { packageId: pkg.id, forDate: new Date() });

    await expect(reactivatePackage(subAdmin.id, { packageId: pkg.id })).rejects.toThrow(
      /forbidden|PACKAGE_MANAGEMENT/i,
    );

    const unchanged = await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(unchanged.isActive).toBe(false);
  });
});

describe("route-level enforcement (SCRUM-107)", () => {
  it("a sub-admin without PACKAGE_MANAGEMENT is rejected at the route level", async () => {
    const subAdmin = await makeAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("PACKAGE_MANAGEMENT", now, token)).rejects.toMatchObject({ status: 403 });
  });

  it("a sub-admin with PACKAGE_MANAGEMENT is allowed at the route level", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({ data: { adminUserId: subAdmin.id, permission: "PACKAGE_MANAGEMENT" } });
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolved = await requirePermission("PACKAGE_MANAGEMENT", now, token);
    expect(resolved.id).toBe(subAdmin.id);
  });

  it("the main admin reaches it with zero explicit grants", async () => {
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(mainAdmin.id, now);

    const resolved = await requirePermission("PACKAGE_MANAGEMENT", now, token);
    expect(resolved.id).toBe(mainAdmin.id);
  });
});

describe("listAllPackages investment-count annotation", () => {
  it("reports the correct investmentCount for a package with and without investments", async () => {
    const pkgWithout = await makePackage(`ListNoInvestment-${crypto.randomUUID()}`, "1000");
    const pkgWith = await makePackage(`ListHasInvestment-${crypto.randomUUID()}`, "1000");
    const buyer = await registerAsRoot({
      email: `pkg-list-buyer-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "List Buyer",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(buyer.id);
    await fundWalletB(buyer.id, "1000");

    const purchaseResult = await purchasePackage(buyer.id, {
      packageId: pkgWith.id,
      forDate: new Date("2026-08-01T10:00:00.000Z"),
      idempotencyKey: `pkg-test-list-purchase:${buyer.id}:${crypto.randomUUID()}`,
    });
    createdInvestmentIds.push(purchaseResult.investment.id);

    const all = await listAllPackages();
    const rowWithout = all.find((p) => p.id === pkgWithout.id)!;
    const rowWith = all.find((p) => p.id === pkgWith.id)!;

    expect(rowWithout.investmentCount).toBe(0);
    expect(rowWith.investmentCount).toBe(1);
  });
});

describe("listPurchasablePackages / listAllPackages", () => {
  it("excludes a deactivated package from the purchasable list but keeps it in the full list", async () => {
    const mainAdmin = await getMainAdmin();
    const pkg = await makePackage(`Listable-${crypto.randomUUID()}`, "777");

    const beforePurchasable = await listPurchasablePackages();
    expect(beforePurchasable.some((p) => p.id === pkg.id)).toBe(true);

    await deactivatePackage(mainAdmin.id, { packageId: pkg.id, forDate: new Date() });

    const afterPurchasable = await listPurchasablePackages();
    expect(afterPurchasable.some((p) => p.id === pkg.id)).toBe(false);

    const all = await listAllPackages();
    expect(all.some((p) => p.id === pkg.id)).toBe(true);
  });
});
