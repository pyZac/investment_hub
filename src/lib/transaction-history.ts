import type { LedgerEntryType, Wallet } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Readable labels for LedgerEntryType (docs/wallet_interest_audit_rules_log.md
 * Section 4: "Transaction type (readable label)"). These are domain/financial
 * terminology, not general UI text — per messages/en.json's own glossary
 * comment and the bilingual-rtl skill, they stay in English in both locales,
 * the same way "Wallet A"/"Binary Commission"/rank names/package names do.
 * Never routed through next-intl.
 */
export const ENTRY_TYPE_LABELS: Record<LedgerEntryType, string> = {
  ADMIN_CREDIT: "Admin Credit",
  PACKAGE_PURCHASE: "Package Purchase",
  DAILY_INTEREST: "Daily Interest",
  DIRECT_COMMISSION: "Direct Commission",
  DIRECT_SAVING: "Direct Commission (Saved)",
  BINARY_COMMISSION: "Binary Commission",
  RANK_REWARD: "Rank Reward",
  WITHDRAWAL_OUT: "Withdrawal",
  WITHDRAWAL_IN: "Withdrawal",
  CAPITAL_RELEASE: "Capital Release",
  SAVING_UNLOCK: "Saving Unlock",
  ADMIN_ADJUSTMENT: "Admin Adjustment",
};

export type TransactionHistoryFilters = {
  wallet?: Wallet;
  entryType?: LedgerEntryType;
  dateFrom?: Date;
  dateTo?: Date;
};

export type TransactionHistoryPage = {
  entries: Array<{
    id: string;
    wallet: Wallet;
    direction: "CREDIT" | "DEBIT";
    amount: string;
    entryType: LedgerEntryType;
    comment: string | null;
    createdAt: Date;
  }>;
  total: number;
};

const PAGE_SIZE = 25;

/**
 * The logged-in user's own ledger entries, newest first, with optional
 * wallet/entry-type/date-range filters and offset pagination. Ownership is
 * enforced by construction (invariant #9) — `userId` is the only scoping
 * filter, no separate target-user param exists.
 *
 * `WHERE user_id = ?` already excludes every paired SYSTEM_EXTERNAL row on
 * its own (those rows always have `user_id IS NULL`, per postTransaction's
 * own invariant) — no additional filtering needed here, unlike the ledger
 * *cleanup* helper's NULL-collision concern (that's about deleting both
 * sides of a pair; this is about reading only the user's own side, which a
 * plain equality filter already does correctly).
 *
 * Offset pagination (`page`, 1-indexed) rather than a cursor: this reads one
 * user's own history, not a high-throughput admin-wide feed, so the simpler
 * page-number model is sufficient and easier to wire to prev/next controls.
 */
export async function listLedgerEntriesForUser(
  userId: string,
  filters: TransactionHistoryFilters,
  page: number,
): Promise<TransactionHistoryPage> {
  const where = {
    userId,
    ...(filters.wallet ? { wallet: filters.wallet } : {}),
    ...(filters.entryType ? { entryType: filters.entryType } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          createdAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.ledgerEntry.count({ where }),
  ]);

  return {
    entries: rows.map((row) => ({
      id: row.id,
      wallet: row.wallet,
      direction: row.direction,
      amount: row.amount.toString(),
      entryType: row.entryType,
      comment: row.comment,
      createdAt: row.createdAt,
    })),
    total,
  };
}

export { PAGE_SIZE };
