"use server";

import { revalidatePath } from "next/cache";
import type { AdminPermission } from "@prisma/client";
import { requireMainAdmin } from "@/lib/route-guard";
import {
  createSubAdmin,
  updateSubAdminPermissions,
  deactivateSubAdmin,
  reactivateSubAdmin,
  getSubAdminActionHistory,
  NotMainAdminError,
  TargetNotSubAdminError,
  CannotModifyMainAdminError,
  EmailAlreadyInUseError,
} from "@/lib/admin-management";

export type SubAdminActionErrorKey =
  | "errorEmailInUse"
  | "errorNotMainAdmin"
  | "errorTargetNotSubAdmin"
  | "errorCannotModifyMainAdmin"
  | "errorGeneric";

export type SubAdminActionResult = { ok: true } | { ok: false; errorKey: SubAdminActionErrorKey };

function mapError(err: unknown): SubAdminActionErrorKey {
  if (err instanceof EmailAlreadyInUseError) return "errorEmailInUse";
  if (err instanceof NotMainAdminError) return "errorNotMainAdmin";
  if (err instanceof TargetNotSubAdminError) return "errorTargetNotSubAdmin";
  if (err instanceof CannotModifyMainAdminError) return "errorCannotModifyMainAdmin";
  return "errorGeneric";
}

/**
 * Every action here calls requireMainAdmin() first — this is the
 * server-side enforcement the phase's exit test calls directly (invariant
 * #8): a sub-admin invoking this action with any client-crafted arguments,
 * even with every other permission granted, is rejected here before
 * admin-management.ts's own re-check ever runs.
 */
export async function createSubAdminAction(
  input: { email: string; password: string; name: string; permissions: AdminPermission[]; reason: string },
  locale: string,
): Promise<SubAdminActionResult> {
  try {
    const actor = await requireMainAdmin(new Date());
    await createSubAdmin(actor.id, input);
    revalidatePath(`/${locale}/admin/sub-admins`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function updateSubAdminPermissionsAction(
  subAdminId: string,
  permissions: AdminPermission[],
  reason: string,
  locale: string,
): Promise<SubAdminActionResult> {
  try {
    const actor = await requireMainAdmin(new Date());
    await updateSubAdminPermissions(actor.id, subAdminId, { permissions, reason });
    revalidatePath(`/${locale}/admin/sub-admins`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function deactivateSubAdminAction(
  subAdminId: string,
  reason: string,
  locale: string,
): Promise<SubAdminActionResult> {
  try {
    const actor = await requireMainAdmin(new Date());
    await deactivateSubAdmin(actor.id, subAdminId, { reason });
    revalidatePath(`/${locale}/admin/sub-admins`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function reactivateSubAdminAction(
  subAdminId: string,
  reason: string,
  locale: string,
): Promise<SubAdminActionResult> {
  try {
    const actor = await requireMainAdmin(new Date());
    await reactivateSubAdmin(actor.id, subAdminId, { reason });
    revalidatePath(`/${locale}/admin/sub-admins`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type SubAdminActionHistoryResult =
  | { ok: true; actions: { id: string; actionType: string; reason: string | null; createdAt: string }[] }
  | { ok: false; errorKey: SubAdminActionErrorKey };

export async function getSubAdminActionHistoryAction(subAdminId: string): Promise<SubAdminActionHistoryResult> {
  try {
    const actor = await requireMainAdmin(new Date());
    const history = await getSubAdminActionHistory(actor.id, subAdminId);
    return {
      ok: true,
      actions: history.map((a) => ({
        id: a.id,
        actionType: a.actionType,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
