import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

async function requirePackageManagement(actingAdminId: string) {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }

  if (!admin.isMainAdmin) {
    const grant = await prisma.adminPermissionGrant.findUnique({
      where: {
        adminUserId_permission: {
          adminUserId: actingAdminId,
          permission: "PACKAGE_MANAGEMENT",
        },
      },
    });
    if (!grant) {
      throw new Error("Forbidden: missing PACKAGE_MANAGEMENT permission.");
    }
  }

  return admin;
}

export const PACKAGE_TIERS = [
  { name: "Starter", amount: "100" },
  { name: "Bronze", amount: "500" },
  { name: "Silver", amount: "1000" },
  { name: "Gold", amount: "5000" },
  { name: "Platinum", amount: "10000" },
  { name: "Diamond", amount: "50000" },
  { name: "Elite", amount: "100000" },
] as const;

export async function seedPackageTiers(client: Prisma.TransactionClient | typeof prisma = prisma) {
  for (const tier of PACKAGE_TIERS) {
    await client.package.upsert({
      where: { name: tier.name },
      update: {},
      create: { name: tier.name, amount: tier.amount },
    });
  }
}

const createPackageInputSchema = z.object({
  name: z.string().min(1),
  amount: z.string().or(z.number()),
});

export type CreatePackageInput = z.infer<typeof createPackageInputSchema>;

export class PackageHasInvestmentsError extends Error {
  constructor() {
    super("This package has existing investments and cannot be edited. Deactivate it instead to stop new purchases.");
    this.name = "PackageHasInvestmentsError";
  }
}

/**
 * Admin package creation. Requires the main admin or a PACKAGE_MANAGEMENT
 * grant. Packages carry name/amount only — no interest rate (Decision 4).
 */
export async function createPackage(actingAdminId: string, input: CreatePackageInput) {
  const data = createPackageInputSchema.parse(input);
  await requirePackageManagement(actingAdminId);

  return prisma.$transaction(async (tx) => {
    const pkg = await tx.package.create({
      data: { name: data.name, amount: data.amount },
    });

    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "PACKAGE_CREATED",
        targetPackageId: pkg.id,
        amount: data.amount,
        reason: `Created package "${pkg.name}".`,
      },
    });

    return pkg;
  });
}

const editPackageInputSchema = z.object({
  packageId: z.string(),
  name: z.string().min(1).optional(),
  amount: z.string().or(z.number()).optional(),
});

export type EditPackageInput = z.infer<typeof editPackageInputSchema>;

/**
 * Admin package edit — name and/or amount only. Never touches isActive/
 * deactivatedAt; use deactivatePackage() for that.
 *
 * Refuses to edit a package that has ANY investment ever made under it
 * (not just status: ACTIVE) — an investment's own `amount` is snapshotted
 * at purchase time so editing the package's amount can never retroactively
 * change it, but a renamed package would make every historical investment
 * display ("Package: Gold") silently inconsistent with what was actually
 * purchased, even for an already CAPITAL_RELEASED investment. Deactivating
 * (hides from new purchases, never touches existing investments) is the
 * correct tool once a package has any investment history — not editing.
 */
export async function editPackage(actingAdminId: string, input: EditPackageInput) {
  const data = editPackageInputSchema.parse(input);
  await requirePackageManagement(actingAdminId);

  const existing = await prisma.package.findUnique({ where: { id: data.packageId } });
  if (!existing) {
    throw new Error("Invalid package: not found.");
  }

  const investmentCount = await prisma.investment.count({ where: { packageId: data.packageId } });
  if (investmentCount > 0) {
    throw new PackageHasInvestmentsError();
  }

  return prisma.$transaction(async (tx) => {
    const pkg = await tx.package.update({
      where: { id: data.packageId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.amount !== undefined ? { amount: data.amount } : {}),
      },
    });

    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "PACKAGE_EDITED",
        targetPackageId: pkg.id,
        amount: data.amount,
        reason: `Edited package "${pkg.name}".`,
      },
    });

    return pkg;
  });
}

const deactivatePackageInputSchema = z.object({
  packageId: z.string(),
  forDate: z.date(),
});

export type DeactivatePackageInput = z.infer<typeof deactivatePackageInputSchema>;

/**
 * Admin package deactivation — hides it from new purchases
 * (listPurchasablePackages) but never touches investments already made under
 * it. forDate is a caller-supplied param, never `new Date()` internally
 * (invariant #4).
 */
export async function deactivatePackage(actingAdminId: string, input: DeactivatePackageInput) {
  const data = deactivatePackageInputSchema.parse(input);
  await requirePackageManagement(actingAdminId);

  const existing = await prisma.package.findUnique({ where: { id: data.packageId } });
  if (!existing) {
    throw new Error("Invalid package: not found.");
  }
  if (!existing.isActive) {
    throw new Error("Package is already deactivated.");
  }

  return prisma.$transaction(async (tx) => {
    const pkg = await tx.package.update({
      where: { id: data.packageId },
      data: { isActive: false, deactivatedAt: data.forDate },
    });

    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "PACKAGE_DEACTIVATED",
        targetPackageId: pkg.id,
        reason: `Deactivated package "${pkg.name}".`,
      },
    });

    return pkg;
  });
}

const reactivatePackageInputSchema = z.object({
  packageId: z.string(),
});

export type ReactivatePackageInput = z.infer<typeof reactivatePackageInputSchema>;

/**
 * Reverses deactivatePackage — makes the package purchasable again. No
 * forDate param (unlike deactivatePackage) since deactivatedAt is simply
 * cleared to null, not stamped with a new timestamp — mirrors
 * reinstateUser's own no-forDate shape for the same reason. Throws if
 * already active, mirroring deactivatePackage's own "already deactivated"
 * throw-not-noop convention (this file's established symmetry, unlike the
 * noop-on-already-in-that-state convention used elsewhere for
 * suspend/reinstate — kept consistent with the sibling function in THIS
 * file rather than a different file's convention).
 */
export async function reactivatePackage(actingAdminId: string, input: ReactivatePackageInput) {
  const data = reactivatePackageInputSchema.parse(input);
  await requirePackageManagement(actingAdminId);

  const existing = await prisma.package.findUnique({ where: { id: data.packageId } });
  if (!existing) {
    throw new Error("Invalid package: not found.");
  }
  if (existing.isActive) {
    throw new Error("Package is already active.");
  }

  return prisma.$transaction(async (tx) => {
    const pkg = await tx.package.update({
      where: { id: data.packageId },
      data: { isActive: true, deactivatedAt: null },
    });

    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "PACKAGE_REACTIVATED",
        targetPackageId: pkg.id,
        reason: `Reactivated package "${pkg.name}".`,
      },
    });

    return pkg;
  });
}

/** Purchasable packages — active only. Used by the purchase flow UI. */
export async function listPurchasablePackages() {
  return prisma.package.findMany({ where: { isActive: true }, orderBy: { amount: "asc" } });
}

/**
 * All packages regardless of status, each annotated with whether it has
 * any investment ever made under it — the admin management view's list
 * needs this to flag "edit locked" rows without a failed submit round
 * trip (see editPackage's own guard for why "any investment," not just
 * status: ACTIVE). Batched via groupBy, not one count query per package.
 */
export async function listAllPackages() {
  const [packages, counts] = await Promise.all([
    prisma.package.findMany({ orderBy: { amount: "asc" } }),
    prisma.investment.groupBy({ by: ["packageId"], _count: { _all: true } }),
  ]);

  const countByPackageId = new Map(counts.map((c) => [c.packageId, c._count._all]));

  return packages.map((pkg) => ({
    ...pkg,
    investmentCount: countByPackageId.get(pkg.id) ?? 0,
  }));
}
