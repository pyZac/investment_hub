"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/route-guard";
import {
  createPackage,
  editPackage,
  deactivatePackage,
  reactivatePackage,
  listAllPackages,
  PackageHasInvestmentsError,
} from "@/lib/packages";

export type PackageActionErrorKey =
  | "errorNameRequired"
  | "errorAmountInvalid"
  | "errorHasInvestments"
  | "errorAlreadyDeactivated"
  | "errorAlreadyActive"
  | "errorNotFound"
  | "errorForbidden"
  | "errorGeneric";

function mapError(err: unknown): PackageActionErrorKey {
  if (err instanceof PackageHasInvestmentsError) return "errorHasInvestments";
  if (err instanceof Error) {
    if (/forbidden/i.test(err.message)) return "errorForbidden";
    if (/not found/i.test(err.message)) return "errorNotFound";
    if (/already deactivated/i.test(err.message)) return "errorAlreadyDeactivated";
    if (/already active/i.test(err.message)) return "errorAlreadyActive";
  }
  return "errorGeneric";
}

export type PackageActionResult = { ok: true } | { ok: false; errorKey: PackageActionErrorKey };

/**
 * Every action here calls requirePermission("PACKAGE_MANAGEMENT", ...)
 * first — the real server-side enforcement point (invariant #8),
 * independent of packages.ts's own inline requirePackageManagement
 * re-check.
 */
export async function createPackageAction(
  name: string,
  amount: string,
  locale: string,
): Promise<PackageActionResult> {
  if (!name.trim()) {
    return { ok: false, errorKey: "errorNameRequired" };
  }
  const parsed = Number(amount);
  if (!amount || Number.isNaN(parsed) || parsed <= 0) {
    return { ok: false, errorKey: "errorAmountInvalid" };
  }
  try {
    const actor = await requirePermission("PACKAGE_MANAGEMENT", new Date());
    await createPackage(actor.id, { name, amount });
    revalidatePath(`/${locale}/admin/packages`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function editPackageAction(
  packageId: string,
  name: string,
  amount: string,
  locale: string,
): Promise<PackageActionResult> {
  if (!name.trim()) {
    return { ok: false, errorKey: "errorNameRequired" };
  }
  const parsed = Number(amount);
  if (!amount || Number.isNaN(parsed) || parsed <= 0) {
    return { ok: false, errorKey: "errorAmountInvalid" };
  }
  try {
    const actor = await requirePermission("PACKAGE_MANAGEMENT", new Date());
    await editPackage(actor.id, { packageId, name, amount });
    revalidatePath(`/${locale}/admin/packages`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function deactivatePackageAction(packageId: string, locale: string): Promise<PackageActionResult> {
  try {
    const actor = await requirePermission("PACKAGE_MANAGEMENT", new Date());
    await deactivatePackage(actor.id, { packageId, forDate: new Date() });
    revalidatePath(`/${locale}/admin/packages`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function reactivatePackageAction(packageId: string, locale: string): Promise<PackageActionResult> {
  try {
    const actor = await requirePermission("PACKAGE_MANAGEMENT", new Date());
    await reactivatePackage(actor.id, { packageId });
    revalidatePath(`/${locale}/admin/packages`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type PackageRow = {
  id: string;
  name: string;
  amount: string;
  isActive: boolean;
  investmentCount: number;
};

export type ListPackagesResult = { ok: true; packages: PackageRow[] } | { ok: false; errorKey: PackageActionErrorKey };

export async function listPackagesAction(): Promise<ListPackagesResult> {
  try {
    await requirePermission("PACKAGE_MANAGEMENT", new Date());
    const packages = await listAllPackages();
    return {
      ok: true,
      packages: packages.map((p) => ({
        id: p.id,
        name: p.name,
        amount: p.amount.toString(),
        isActive: p.isActive,
        investmentCount: p.investmentCount,
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
