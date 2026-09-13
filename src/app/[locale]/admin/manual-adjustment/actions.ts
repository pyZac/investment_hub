"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/route-guard";
import { searchUsers } from "@/lib/user-management";
import { listLedgerEntriesForUser, ENTRY_TYPE_LABELS } from "@/lib/transaction-history";
import { prisma } from "@/lib/prisma";
import {
  findLedgerTransactionByEntryId,
  reverseLedgerTransaction,
  listRecentManualAdjustments,
  LedgerTransactionNotFoundError,
  AlreadyReversedError,
} from "@/lib/manual-adjustment";

export type AdjustmentActionErrorKey =
  | "errorReasonRequired"
  | "errorNotFound"
  | "errorAlreadyReversed"
  | "errorForbidden"
  | "errorGeneric";

function mapError(err: unknown): AdjustmentActionErrorKey {
  if (err instanceof LedgerTransactionNotFoundError) return "errorNotFound";
  if (err instanceof AlreadyReversedError) return "errorAlreadyReversed";
  if (err instanceof Error) {
    if (/forbidden/i.test(err.message)) return "errorForbidden";
    if (/reason/i.test(err.message)) return "errorReasonRequired";
  }
  return "errorGeneric";
}

export type UserOption = { id: string; name: string; email: string };
export type SearchUsersResult = { ok: true; users: UserOption[] } | { ok: false; errorKey: AdjustmentActionErrorKey };

/**
 * Backs the user picker. searchUsers accepts USER_MANAGEMENT,
 * CREDIT_ISSUANCE, or MANUAL_ADJUSTMENT (see user-management.ts) — this
 * route still calls requirePermission("MANUAL_ADJUSTMENT", ...) first as
 * the real enforcement point for THIS screen specifically.
 */
export async function searchUsersAction(query: string): Promise<SearchUsersResult> {
  try {
    const actor = await requirePermission("MANUAL_ADJUSTMENT", new Date());
    const result = await searchUsers(actor.id, { query });
    return { ok: true, users: result.users.map((u) => ({ id: u.id, name: u.name, email: u.email })) };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type LedgerEntryRow = {
  id: string;
  wallet: string;
  direction: "CREDIT" | "DEBIT";
  amount: string;
  entryTypeLabel: string;
  comment: string | null;
  idempotencyKey: string;
  createdAt: string;
};

export type ListUserEntriesResult =
  | { ok: true; entries: LedgerEntryRow[] }
  | { ok: false; errorKey: AdjustmentActionErrorKey };

/**
 * Lists a target user's ledger entries for the "search/select an entry to
 * reverse" step. listLedgerEntriesForUser itself takes a bare userId with
 * no internal permission check (real callers, like the user's own
 * /transactions page, enforce ownership before calling it) — this route's
 * own requirePermission("MANUAL_ADJUSTMENT", ...) check is what makes
 * calling it here, for an ARBITRARY target user, safe: an admin browsing
 * any user's ledger by design is the whole point of this screen, same
 * posture as searchUsers/listRankConfigs elsewhere in the admin panel.
 * idempotencyKey is included per-row so the client can pass it straight
 * into the confirm step without a second round-trip.
 */
export async function listUserLedgerEntriesAction(userId: string): Promise<ListUserEntriesResult> {
  try {
    await requirePermission("MANUAL_ADJUSTMENT", new Date());
    const page = await listLedgerEntriesForUser(userId, {}, 1);

    // listLedgerEntriesForUser's shared return shape (also used by the
    // real user-facing /transactions page) doesn't expose idempotencyKey —
    // this screen needs it to pass straight into the confirm step, so
    // fetch it directly for just the ids already selected, rather than
    // widening that shared type for one admin-only field.
    const keysById = new Map(
      (
        await prisma.ledgerEntry.findMany({
          where: { id: { in: page.entries.map((e) => e.id) } },
          select: { id: true, idempotencyKey: true },
        })
      ).map((row) => [row.id, row.idempotencyKey]),
    );

    return {
      ok: true,
      entries: page.entries.map((e) => ({
        id: e.id,
        wallet: e.wallet,
        direction: e.direction,
        amount: e.amount,
        entryTypeLabel: ENTRY_TYPE_LABELS[e.entryType],
        comment: e.comment,
        idempotencyKey: keysById.get(e.id)!,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type TransactionRow = {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  wallet: string;
  direction: "CREDIT" | "DEBIT";
  amount: string;
  entryTypeLabel: string;
  comment: string | null;
  createdAt: string;
};

export type FindTransactionResult =
  | { ok: true; transaction: TransactionRow[] }
  | { ok: false; errorKey: AdjustmentActionErrorKey };

export async function findLedgerTransactionAction(entryId: string): Promise<FindTransactionResult> {
  try {
    const actor = await requirePermission("MANUAL_ADJUSTMENT", new Date());
    const rows = await findLedgerTransactionByEntryId(actor.id, entryId);
    return {
      ok: true,
      transaction: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.userName,
        userEmail: r.userEmail,
        wallet: r.wallet,
        direction: r.direction,
        amount: r.amount,
        entryTypeLabel: ENTRY_TYPE_LABELS[r.entryType as keyof typeof ENTRY_TYPE_LABELS],
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type ReverseActionResult = { ok: true } | { ok: false; errorKey: AdjustmentActionErrorKey };

/**
 * Calls requirePermission("MANUAL_ADJUSTMENT", ...) first — the real
 * server-side enforcement point (invariant #8), before manual-adjustment.ts's
 * own inline re-check ever runs. The reason is required here too, before
 * either check happens, so a blank reason never reaches the database layer.
 */
export async function reverseLedgerTransactionAction(
  idempotencyKey: string,
  reason: string,
  locale: string,
): Promise<ReverseActionResult> {
  if (!reason.trim()) {
    return { ok: false, errorKey: "errorReasonRequired" };
  }

  try {
    const actor = await requirePermission("MANUAL_ADJUSTMENT", new Date());
    await reverseLedgerTransaction(actor.id, { idempotencyKey, reason });
    revalidatePath(`/${locale}/admin/manual-adjustment`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type RecentAdjustmentRow = {
  id: string;
  adminName: string;
  reason: string | null;
  createdAt: string;
};

export type RecentAdjustmentsResult =
  | { ok: true; adjustments: RecentAdjustmentRow[] }
  | { ok: false; errorKey: AdjustmentActionErrorKey };

export async function listRecentManualAdjustmentsAction(): Promise<RecentAdjustmentsResult> {
  try {
    const actor = await requirePermission("MANUAL_ADJUSTMENT", new Date());
    const adjustments = await listRecentManualAdjustments(actor.id);
    return {
      ok: true,
      adjustments: adjustments.map((a) => ({
        id: a.id,
        adminName: a.adminName,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
