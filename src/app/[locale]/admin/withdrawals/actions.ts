"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/route-guard";
import {
  approveWithdrawalRequest,
  rejectWithdrawalRequest,
  listPendingWithdrawalRequests,
  listDecidedWithdrawalRequests,
  WithdrawalRequestNotPendingError,
} from "@/lib/withdrawal-requests";

export type WithdrawalActionErrorKey =
  | "errorReasonRequired"
  | "errorAlreadyDecided"
  | "errorForbidden"
  | "errorGeneric";

export type WithdrawalActionResult = { ok: true } | { ok: false; errorKey: WithdrawalActionErrorKey };

function mapError(err: unknown): WithdrawalActionErrorKey {
  if (err instanceof WithdrawalRequestNotPendingError) return "errorAlreadyDecided";
  if (err instanceof Error) {
    if (/forbidden/i.test(err.message)) return "errorForbidden";
    if (/comment/i.test(err.message)) return "errorReasonRequired";
  }
  return "errorGeneric";
}

/**
 * Every action here calls requirePermission("WITHDRAWAL_APPROVAL", ...)
 * first — the real server-side enforcement point (invariant #8), before
 * withdrawal-requests.ts's own inline requireWithdrawalApproval re-check
 * ever runs. A reason is required for BOTH approve and reject at this
 * layer (checked before either lib function is even called) — the ticket
 * treats it as mandatory for approve too, even though the underlying
 * approveWithdrawalRequest keeps its comment param optional for backward
 * compatibility with existing non-admin-panel callers.
 */
export async function approveWithdrawalRequestAction(
  requestId: string,
  reason: string,
  locale: string,
): Promise<WithdrawalActionResult> {
  if (!reason.trim()) {
    return { ok: false, errorKey: "errorReasonRequired" };
  }
  try {
    const actor = await requirePermission("WITHDRAWAL_APPROVAL", new Date());
    await approveWithdrawalRequest(actor.id, requestId, new Date(), reason);
    revalidatePath(`/${locale}/admin/withdrawals`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function rejectWithdrawalRequestAction(
  requestId: string,
  reason: string,
  locale: string,
): Promise<WithdrawalActionResult> {
  if (!reason.trim()) {
    return { ok: false, errorKey: "errorReasonRequired" };
  }
  try {
    const actor = await requirePermission("WITHDRAWAL_APPROVAL", new Date());
    await rejectWithdrawalRequest(actor.id, requestId, reason, new Date());
    revalidatePath(`/${locale}/admin/withdrawals`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type PendingRow = {
  id: string;
  userName: string;
  userEmail: string;
  amount: string;
  requestedAt: string;
  walletBBalance: string;
};

export type PendingQueueResult = { ok: true; requests: PendingRow[] } | { ok: false; errorKey: WithdrawalActionErrorKey };

export async function listPendingWithdrawalRequestsAction(): Promise<PendingQueueResult> {
  try {
    const actor = await requirePermission("WITHDRAWAL_APPROVAL", new Date());
    const requests = await listPendingWithdrawalRequests(actor.id);
    return {
      ok: true,
      requests: requests.map((r) => ({
        id: r.id,
        userName: r.userName,
        userEmail: r.userEmail,
        amount: r.amount.toString(),
        requestedAt: r.requestedAt.toISOString(),
        walletBBalance: r.walletBBalance.toString(),
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type DecidedRow = {
  id: string;
  userName: string;
  userEmail: string;
  amount: string;
  status: "APPROVED" | "REJECTED";
  requestedAt: string;
  decidedAt: string | null;
  decidedByAdminName: string | null;
  adminComment: string | null;
};

export type DecisionHistoryResult = { ok: true; requests: DecidedRow[] } | { ok: false; errorKey: WithdrawalActionErrorKey };

export async function listDecidedWithdrawalRequestsAction(): Promise<DecisionHistoryResult> {
  try {
    const actor = await requirePermission("WITHDRAWAL_APPROVAL", new Date());
    const requests = await listDecidedWithdrawalRequests(actor.id);
    return {
      ok: true,
      requests: requests.map((r) => ({
        id: r.id,
        userName: r.userName,
        userEmail: r.userEmail,
        amount: r.amount.toString(),
        status: r.status as "APPROVED" | "REJECTED",
        requestedAt: r.requestedAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        decidedByAdminName: r.decidedByAdminName,
        adminComment: r.adminComment,
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
