"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/route-guard";
import {
  adminCreateUser,
  suspendUser,
  reinstateUser,
  toggleMarketerStatus,
  CannotSuspendMainAdminError,
} from "@/lib/users";
import { searchUsers, getUserDetail } from "@/lib/user-management";
import { adminResetPassword, CannotResetMainAdminPasswordError } from "@/lib/security-questions";
import { toDisplayWithCurrency } from "@/lib/display";

export type UserManagementActionErrorKey =
  | "errorSponsorNotFound"
  | "errorSponsorSuspended"
  | "errorEmailInUse"
  | "errorCannotSuspendMainAdmin"
  | "errorCannotResetMainAdminPassword"
  | "errorReasonRequired"
  | "errorPasswordMismatch"
  | "errorPasswordTooShort"
  | "errorForbidden"
  | "errorGeneric";

export type UserManagementActionResult =
  | { ok: true; userId: string }
  | { ok: false; errorKey: UserManagementActionErrorKey };

function mapError(err: unknown): UserManagementActionErrorKey {
  if (err instanceof CannotSuspendMainAdminError) return "errorCannotSuspendMainAdmin";
  if (err instanceof CannotResetMainAdminPasswordError) return "errorCannotResetMainAdminPassword";
  if (err instanceof Error) {
    if (/invalid sponsor: user not found/i.test(err.message)) return "errorSponsorNotFound";
    if (/invalid sponsor: account is suspended/i.test(err.message)) return "errorSponsorSuspended";
    if (/forbidden/i.test(err.message)) return "errorForbidden";
    if (/a reason is required/i.test(err.message)) return "errorReasonRequired";
    if (/unique constraint/i.test(err.message) || /email/i.test(err.message)) return "errorEmailInUse";
  }
  return "errorGeneric";
}

/**
 * Every action here calls requirePermission("USER_MANAGEMENT", ...) first —
 * this is the server-side enforcement point the exit test calls directly
 * (invariant #8): a sub-admin without the grant is rejected here, before
 * users.ts's own inline re-check (assertHasUserManagementPermission) ever
 * runs. Both checks independently agree; neither is the UI hiding a button.
 */
export async function createUserAction(
  input: {
    email: string;
    password: string;
    name: string;
    sponsorId?: string;
    reason: string;
    isMarketer?: boolean;
  },
  locale: string,
): Promise<UserManagementActionResult> {
  try {
    const actor = await requirePermission("USER_MANAGEMENT", new Date());
    const user = await adminCreateUser(actor.id, input);
    revalidatePath(`/${locale}/admin/users`);
    return { ok: true, userId: user.id };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type SearchUsersActionResult =
  | {
      ok: true;
      users: {
        id: string;
        name: string;
        email: string;
        createdAt: string;
        suspendedAt: string | null;
        currentRank: string | null;
      }[];
      total: number;
      page: number;
      pageSize: number;
    }
  | { ok: false; errorKey: UserManagementActionErrorKey };

export async function searchUsersAction(query: string, page: number): Promise<SearchUsersActionResult> {
  try {
    const actor = await requirePermission("USER_MANAGEMENT", new Date());
    const result = await searchUsers(actor.id, { query, page });
    return {
      ok: true,
      users: result.users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        createdAt: u.createdAt.toISOString(),
        suspendedAt: u.suspendedAt?.toISOString() ?? null,
        currentRank: u.currentRank,
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type UserDetailActionResult =
  | {
      ok: true;
      detail: {
        id: string;
        name: string;
        email: string;
        createdAt: string;
        suspendedAt: string | null;
        sponsorId: string | null;
        wallets: { A: string; B: string; C: string; SAVING: string };
        activeInvestmentCount: number;
        referralCount: number;
        currentRank: string | null;
        isMarketer: boolean;
        isMainAdmin: boolean;
      };
    }
  | { ok: false; errorKey: UserManagementActionErrorKey };

export async function getUserDetailAction(targetUserId: string): Promise<UserDetailActionResult> {
  try {
    const actor = await requirePermission("USER_MANAGEMENT", new Date());
    const detail = await getUserDetail(actor.id, targetUserId);
    return {
      ok: true,
      detail: {
        id: detail.id,
        name: detail.name,
        email: detail.email,
        createdAt: detail.createdAt.toISOString(),
        suspendedAt: detail.suspendedAt?.toISOString() ?? null,
        sponsorId: detail.sponsorId,
        wallets: {
          A: toDisplayWithCurrency(detail.wallets.A),
          B: toDisplayWithCurrency(detail.wallets.B),
          C: toDisplayWithCurrency(detail.wallets.C),
          SAVING: toDisplayWithCurrency(detail.wallets.SAVING),
        },
        activeInvestmentCount: detail.activeInvestmentCount,
        referralCount: detail.referralCount,
        currentRank: detail.currentRank,
        isMarketer: detail.isMarketer,
        isMainAdmin: detail.isMainAdmin,
      },
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function suspendUserAction(
  targetUserId: string,
  reason: string,
  locale: string,
): Promise<UserManagementActionResult> {
  try {
    const actor = await requirePermission("USER_MANAGEMENT", new Date());
    const user = await suspendUser(actor.id, targetUserId, { reason }, new Date());
    revalidatePath(`/${locale}/admin/users`);
    return { ok: true, userId: user.id };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function reinstateUserAction(
  targetUserId: string,
  reason: string,
  locale: string,
): Promise<UserManagementActionResult> {
  try {
    const actor = await requirePermission("USER_MANAGEMENT", new Date());
    const user = await reinstateUser(actor.id, targetUserId, { reason });
    revalidatePath(`/${locale}/admin/users`);
    return { ok: true, userId: user.id };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function toggleMarketerStatusAction(
  targetUserId: string,
  locale: string,
): Promise<UserManagementActionResult> {
  try {
    const actor = await requirePermission("USER_MANAGEMENT", new Date());
    const user = await toggleMarketerStatus(actor.id, targetUserId, new Date());
    revalidatePath(`/${locale}/admin/users`);
    return { ok: true, userId: user.id };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

/**
 * newPassword/confirmPassword match is re-verified here (not just trusted
 * from the client) before ever calling into adminResetPassword — matching
 * this codebase's standing pattern of never trusting client-only validation
 * for anything that mutates a credential or moves money.
 */
export async function adminResetPasswordAction(
  targetUserId: string,
  newPassword: string,
  confirmPassword: string,
  reason: string,
  locale: string,
): Promise<UserManagementActionResult> {
  if (newPassword !== confirmPassword) {
    return { ok: false, errorKey: "errorPasswordMismatch" };
  }
  if (newPassword.length < 8) {
    return { ok: false, errorKey: "errorPasswordTooShort" };
  }

  try {
    const actor = await requirePermission("USER_MANAGEMENT", new Date());
    await adminResetPassword(actor.id, targetUserId, { newPassword, reason });
    revalidatePath(`/${locale}/admin/users`);
    return { ok: true, userId: targetUserId };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
