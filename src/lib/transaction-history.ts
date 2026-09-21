import type { LedgerEntryType, Wallet, Prisma } from "@prisma/client";
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
  USER_TRANSFER_SENT: "Transfer Sent",
  USER_TRANSFER_RECEIVED: "Transfer Received",
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
    description: string;
    createdAt: Date;
  }>;
  total: number;
};

const PAGE_SIZE = 25;

/**
 * Entry types whose stored `comment` embeds a raw investment id (e.g.
 * "Direct Commission for investment cmua5y7c00010p5014tzwynf3") — not
 * meaningful to a user. Ledger entries are append-only (invariant #2), so
 * the stored comment text can never be edited retroactively, even for
 * historical rows; the fix has to be a display-time label computed from
 * referenceType/referenceId instead of showing the raw comment.
 */
const INVESTMENT_REFERENCED_ENTRY_TYPES: ReadonlySet<LedgerEntryType> = new Set([
  "DIRECT_COMMISSION",
  "DIRECT_SAVING",
  "DAILY_INTEREST",
  "CAPITAL_RELEASE",
]);

/**
 * DIRECT_COMMISSION/DIRECT_SAVING are the only two entry types where the
 * viewing user (the sponsor) isn't the investment's owner — the referenced
 * investment belongs to the referred user whose purchase triggered the
 * commission (direct-commission.ts: referenceId is always the investment
 * id, investment.userId is the buyer, not the sponsor receiving this
 * entry). DAILY_INTEREST/CAPITAL_RELEASE's referenced investment IS the
 * viewing user's own, so naming its buyer would be naming themselves —
 * no value added, left as the plain "{Label} — {PackageName}" format.
 */
const REFERRED_BUYER_ENTRY_TYPES: ReadonlySet<LedgerEntryType> = new Set(["DIRECT_COMMISSION", "DIRECT_SAVING"]);

type InvestmentInfo = { packageName: string; buyerName: string };

const TRANSFER_ENTRY_TYPES: ReadonlySet<LedgerEntryType> = new Set([
  "USER_TRANSFER_SENT",
  "USER_TRANSFER_RECEIVED",
]);

/**
 * user-transfer.ts stamps `metadata: { counterpartyId, counterpartyName }`
 * on both sides of a peer-to-peer transfer at write time specifically so a
 * later display layer never needs a join to name the other party — read it
 * back here rather than re-deriving anything. `metadata` is untyped JSON at
 * the Prisma level, so this narrows defensively instead of trusting the
 * shape blindly (a row written before this metadata field existed, or by
 * some future different write path, could have anything in it).
 */
function counterpartyNameFromMetadata(metadata: Prisma.JsonValue | null): string | null {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const name = (metadata as Record<string, unknown>).counterpartyName;
    if (typeof name === "string") {
      return name;
    }
  }
  return null;
}

/**
 * A human-readable description for one ledger row, replacing the raw
 * stored `comment` for entry types known to embed an id the user can't
 * make sense of. `investmentInfoById` is pre-fetched once per page
 * (batched, not N+1) by the caller. Entry types with no natural
 * human-readable substitute (SAVING_UNLOCK's lot id, WITHDRAWAL_OUT's
 * request id) just drop the raw id rather than inventing one — the row's
 * own amount/date/wallet badge already carries the relevant context.
 */
function buildDescription(
  entryType: LedgerEntryType,
  referenceId: string | null,
  metadata: Prisma.JsonValue | null,
  investmentInfoById: Map<string, InvestmentInfo>,
): string {
  if (TRANSFER_ENTRY_TYPES.has(entryType)) {
    const counterpartyName = counterpartyNameFromMetadata(metadata);
    if (counterpartyName) {
      return entryType === "USER_TRANSFER_SENT"
        ? `Transfer sent to ${counterpartyName}`
        : `Transfer received from ${counterpartyName}`;
    }
    return ENTRY_TYPE_LABELS[entryType];
  }

  if (INVESTMENT_REFERENCED_ENTRY_TYPES.has(entryType)) {
    const info = referenceId ? investmentInfoById.get(referenceId) : undefined;
    if (info) {
      if (REFERRED_BUYER_ENTRY_TYPES.has(entryType)) {
        return `${ENTRY_TYPE_LABELS[entryType]} from ${info.buyerName}'s investment — ${info.packageName}`;
      }
      return `${ENTRY_TYPE_LABELS[entryType]} — ${info.packageName}`;
    }
  }
  return ENTRY_TYPE_LABELS[entryType];
}

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

  const investmentIds = [
    ...new Set(
      rows
        .filter((row) => INVESTMENT_REFERENCED_ENTRY_TYPES.has(row.entryType) && row.referenceId)
        .map((row) => row.referenceId!),
    ),
  ];
  const investments =
    investmentIds.length > 0
      ? await prisma.investment.findMany({
          where: { id: { in: investmentIds } },
          select: { id: true, package: { select: { name: true } }, user: { select: { name: true } } },
        })
      : [];
  const investmentInfoById = new Map<string, InvestmentInfo>(
    investments.map((inv) => [inv.id, { packageName: inv.package.name, buyerName: inv.user.name }]),
  );

  return {
    entries: rows.map((row) => ({
      id: row.id,
      wallet: row.wallet,
      direction: row.direction,
      amount: row.amount.toString(),
      entryType: row.entryType,
      comment: row.comment,
      description: buildDescription(row.entryType, row.referenceId, row.metadata, investmentInfoById),
      createdAt: row.createdAt,
    })),
    total,
  };
}

export { PAGE_SIZE };
