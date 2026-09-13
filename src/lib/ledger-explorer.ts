import type { LedgerEntryType, Wallet } from "@prisma/client";
import { prisma } from "./prisma";
import { ENTRY_TYPE_LABELS } from "./transaction-history";
import { walletDisplayLabel } from "./wallet-display";

const PLATFORM_RESERVE_LABEL = "Platform Reserve";
const PAGE_SIZE = 50;
/**
 * Safety cap on CSV export row count — this is an internal simulation with a
 * bounded, small ledger (no real-world transaction volume), so this exists
 * only to prevent an unbounded query, not to silently truncate a real export.
 */
const EXPORT_ROW_LIMIT = 50_000;

async function assertHasLedgerViewPermission(actingAdminId: string): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }
  if (admin.isMainAdmin) {
    return;
  }
  const grant = await prisma.adminPermissionGrant.findUnique({
    where: { adminUserId_permission: { adminUserId: actingAdminId, permission: "LEDGER_VIEW" } },
  });
  if (!grant) {
    throw new Error("Forbidden: missing LEDGER_VIEW permission.");
  }
}

export type LedgerExplorerFilters = {
  userId?: string;
  entryType?: LedgerEntryType;
  wallet?: Wallet;
  dateFrom?: Date;
  dateTo?: Date;
};

export type LedgerExplorerRow = {
  id: string;
  createdAt: Date;
  /** The counterparty user's display name, or "Platform Reserve" for the
   * SYSTEM_EXTERNAL side of a pair (userId is null on that row). Computed
   * here, server-side, so a raw SYSTEM_EXTERNAL/null never reaches a caller. */
  userLabel: string;
  wallet: Wallet;
  walletLabel: string;
  entryType: LedgerEntryType;
  entryTypeLabel: string;
  direction: "CREDIT" | "DEBIT";
  amount: string;
  comment: string | null;
};

function buildWhere(filters: LedgerExplorerFilters) {
  return {
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.entryType ? { entryType: filters.entryType } : {}),
    ...(filters.wallet ? { wallet: filters.wallet } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          createdAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  };
}

function toRow(entry: {
  id: string;
  createdAt: Date;
  user: { name: string } | null;
  wallet: Wallet;
  entryType: LedgerEntryType;
  direction: "CREDIT" | "DEBIT";
  amount: { toString(): string };
  comment: string | null;
}): LedgerExplorerRow {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    userLabel: entry.user?.name ?? PLATFORM_RESERVE_LABEL,
    wallet: entry.wallet,
    walletLabel: walletDisplayLabel(entry.wallet),
    entryType: entry.entryType,
    entryTypeLabel: ENTRY_TYPE_LABELS[entry.entryType],
    direction: entry.direction,
    amount: entry.amount.toString(),
    comment: entry.comment,
  };
}

/**
 * The admin ledger explorer's paginated result set (SCRUM-114,
 * docs/phases/phase-11-admin-panel.md item 12). LEDGER_VIEW-gated (main
 * admin bypass). Reads via the existing `ledgerEntry` model directly — no
 * new write path, no new table. Filters combine (all optional, ANDed).
 */
export async function queryLedgerEntries(
  actingAdminId: string,
  filters: LedgerExplorerFilters,
  page: number,
): Promise<{ rows: LedgerExplorerRow[]; total: number }> {
  await assertHasLedgerViewPermission(actingAdminId);

  const where = buildWhere(filters);

  const [entries, total] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { name: true } } },
    }),
    prisma.ledgerEntry.count({ where }),
  ]);

  return { rows: entries.map(toRow), total };
}

/**
 * The full filtered result set, unpaginated, for CSV export — same filters
 * and same underlying query as `queryLedgerEntries`, just without the
 * skip/take page window, so the export always matches the filtered table
 * exactly (every matching row, not just the current page).
 */
export async function queryLedgerEntriesForExport(
  actingAdminId: string,
  filters: LedgerExplorerFilters,
): Promise<LedgerExplorerRow[]> {
  await assertHasLedgerViewPermission(actingAdminId);

  const where = buildWhere(filters);

  const entries = await prisma.ledgerEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: EXPORT_ROW_LIMIT,
    include: { user: { select: { name: true } } },
  });

  return entries.map(toRow);
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const CSV_HEADER = ["Date", "User", "Wallet", "Entry Type", "Direction", "Amount", "Comment"];

/**
 * Renders a set of rows (already fetched via `queryLedgerEntriesForExport`)
 * as CSV text. Pure formatting — takes rows in, not a DB call, so it can be
 * unit-tested against an exact known row set independent of permission
 * checks or the query itself.
 */
export function rowsToCsv(rows: LedgerExplorerRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.createdAt.toISOString(),
        row.userLabel,
        row.walletLabel,
        row.entryTypeLabel,
        row.direction,
        row.amount,
        row.comment ?? "",
      ]
        .map((v) => csvEscape(String(v)))
        .join(","),
    );
  }
  return lines.join("\n");
}
