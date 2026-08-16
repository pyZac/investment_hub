import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import {
  PACKAGE_TIERS,
  seedPackageTiers,
  createPackage,
  editPackage,
  deactivatePackage,
  listPurchasablePackages,
  listAllPackages,
} from "./packages";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];

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

afterAll(async () => {
  await prisma.adminAction.deleteMany({
    where: {
      OR: [{ adminId: { in: createdUserIds } }, { targetPackageId: { in: createdPackageIds } }],
    },
  });
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
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
