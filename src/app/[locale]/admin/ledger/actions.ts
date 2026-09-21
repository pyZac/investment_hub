"use server";

import type { LedgerEntryType, Wallet } from "@prisma/client";
import { requirePermission } from "@/lib/route-guard";
import { searchUsers } from "@/lib/user-management";
import { queryLedgerEntries, queryLedgerEntriesForExport, rowsToCsv, type LedgerExplorerFilters } from "@/lib/ledger-explorer";
import { toDisplayWithCurrency } from "@/lib/display";

export type LedgerActionErrorKey = "errorForbidden" | "errorGeneric";

function mapError(err: unknown): LedgerActionErrorKey {
  if (err instanceof Error && /forbidden/i.test(err.message)) return "errorForbidden";
  return "errorGeneric";
}

export type UserOption = { id: string; name: string; email: string };
export type SearchUsersResult = { ok: true; users: UserOption[] } | { ok: false; errorKey: LedgerActionErrorKey };

/**
 * Backs the ledger explorer's user filter picker. searchUsers itself accepts
 * USER_MANAGEMENT/CREDIT_ISSUANCE/MANUAL_ADJUSTMENT callers too — this
 * route's own requirePermission("LEDGER_VIEW", ...) call is the real
 * enforcement point for this screen specifically (invariant #8), same
 * pattern as the manual-adjustment screen's identical picker.
 */
export async function searchUsersAction(query: string): Promise<SearchUsersResult> {
  try {
    const actor = await requirePermission("LEDGER_VIEW", new Date());
    const result = await searchUsers(actor.id, { query });
    return { ok: true, users: result.users.map((u) => ({ id: u.id, name: u.name, email: u.email })) };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type LedgerRow = {
  id: string;
  createdAt: string;
  userLabel: string;
  walletLabel: string;
  entryTypeLabel: string;
  direction: "CREDIT" | "DEBIT";
  amount: string;
  comment: string | null;
};

export type LedgerFiltersInput = {
  userId?: string;
  entryType?: LedgerEntryType;
  wallet?: Wallet;
  dateFrom?: string;
  dateTo?: string;
};

function toFilters(input: LedgerFiltersInput): LedgerExplorerFilters {
  return {
    userId: input.userId || undefined,
    entryType: input.entryType || undefined,
    wallet: input.wallet || undefined,
    dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
    dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
  };
}

export type QueryLedgerResult =
  | { ok: true; rows: LedgerRow[]; total: number }
  | { ok: false; errorKey: LedgerActionErrorKey };

export async function queryLedgerEntriesAction(
  filters: LedgerFiltersInput,
  page: number,
): Promise<QueryLedgerResult> {
  try {
    const actor = await requirePermission("LEDGER_VIEW", new Date());
    const result = await queryLedgerEntries(actor.id, toFilters(filters), page);
    return {
      ok: true,
      total: result.total,
      rows: result.rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        userLabel: r.userLabel,
        walletLabel: r.walletLabel,
        entryTypeLabel: r.entryTypeLabel,
        direction: r.direction,
        amount: toDisplayWithCurrency(r.amount),
        comment: r.comment,
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type ExportLedgerResult = { ok: true; csv: string } | { ok: false; errorKey: LedgerActionErrorKey };

/**
 * Exports the full filtered result set (no page window) as CSV text — the
 * client triggers a download from the returned string via a Blob, no
 * server-side file write. Uses the exact same filtered query as the table
 * (`queryLedgerEntriesForExport` shares `buildWhere` with `queryLedgerEntries`
 * internally), so the export always matches what's on screen.
 */
export async function exportLedgerEntriesAction(filters: LedgerFiltersInput): Promise<ExportLedgerResult> {
  try {
    const actor = await requirePermission("LEDGER_VIEW", new Date());
    const rows = await queryLedgerEntriesForExport(actor.id, toFilters(filters));
    return { ok: true, csv: rowsToCsv(rows) };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
