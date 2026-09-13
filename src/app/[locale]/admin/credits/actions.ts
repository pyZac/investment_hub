"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/route-guard";
import { adminCreditWalletB, listRecentCreditIssuances } from "@/lib/admin-credit";
import { searchUsers } from "@/lib/user-management";

export type CreditActionErrorKey =
  | "errorReasonRequired"
  | "errorAmountInvalid"
  | "errorUserNotFound"
  | "errorUserSuspended"
  | "errorForbidden"
  | "errorGeneric";

function mapError(err: unknown): CreditActionErrorKey {
  if (err instanceof Error) {
    if (/forbidden/i.test(err.message)) return "errorForbidden";
    if (/user not found/i.test(err.message)) return "errorUserNotFound";
    if (/account is suspended/i.test(err.message)) return "errorUserSuspended";
    if (/reason/i.test(err.message)) return "errorReasonRequired";
  }
  return "errorGeneric";
}

export type CreditActionResult = { ok: true } | { ok: false; errorKey: CreditActionErrorKey };

/**
 * Calls requirePermission("CREDIT_ISSUANCE", ...) first — the real
 * server-side enforcement point (invariant #8), before admin-credit.ts's
 * own inline re-check ever runs. The reason is required here too, before
 * either check even happens, so a blank reason never reaches the database
 * layer at all — matching the ticket's "refused at the route level, not
 * just the UI" requirement.
 */
export async function creditWalletBAction(
  userId: string,
  amount: string,
  reason: string,
  locale: string,
): Promise<CreditActionResult> {
  if (!reason.trim()) {
    return { ok: false, errorKey: "errorReasonRequired" };
  }
  const parsed = Number(amount);
  if (!amount || Number.isNaN(parsed) || parsed <= 0) {
    return { ok: false, errorKey: "errorAmountInvalid" };
  }

  try {
    const actor = await requirePermission("CREDIT_ISSUANCE", new Date());
    await adminCreditWalletB(actor.id, {
      userId,
      amount,
      reason,
      idempotencyKey: `admin_credit_ui:${actor.id}:${userId}:${randomUUID()}`,
    });
    revalidatePath(`/${locale}/admin/credits`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type UserOption = { id: string; name: string; email: string };
export type SearchUsersResult = { ok: true; users: UserOption[] } | { ok: false; errorKey: CreditActionErrorKey };

/**
 * Backs the credit form's user picker. searchUsers itself accepts either
 * USER_MANAGEMENT or CREDIT_ISSUANCE (see user-management.ts) — this route
 * still calls requirePermission("CREDIT_ISSUANCE", ...) first as the real
 * enforcement point for THIS screen specifically, consistent with every
 * other admin action file.
 */
export async function searchUsersAction(query: string): Promise<SearchUsersResult> {
  try {
    const actor = await requirePermission("CREDIT_ISSUANCE", new Date());
    const result = await searchUsers(actor.id, { query });
    return { ok: true, users: result.users.map((u) => ({ id: u.id, name: u.name, email: u.email })) };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type RecentCreditRow = {
  id: string;
  targetUserName: string | null;
  targetUserEmail: string | null;
  adminName: string;
  amount: string;
  reason: string | null;
  createdAt: string;
};

export type RecentCreditsResult = { ok: true; credits: RecentCreditRow[] } | { ok: false; errorKey: CreditActionErrorKey };

export async function listRecentCreditIssuancesAction(): Promise<RecentCreditsResult> {
  try {
    const actor = await requirePermission("CREDIT_ISSUANCE", new Date());
    const credits = await listRecentCreditIssuances(actor.id);
    return {
      ok: true,
      credits: credits.map((c) => ({
        id: c.id,
        targetUserName: c.targetUserName,
        targetUserEmail: c.targetUserEmail,
        adminName: c.adminName,
        amount: c.amount?.toString() ?? "0",
        reason: c.reason,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
