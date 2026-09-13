import { z } from "zod";
import type { Wallet } from "@prisma/client";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";

async function assertHasManualAdjustmentPermission(actingAdminId: string): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }
  if (admin.isMainAdmin) {
    return;
  }
  const grant = await prisma.adminPermissionGrant.findUnique({
    where: { adminUserId_permission: { adminUserId: actingAdminId, permission: "MANUAL_ADJUSTMENT" } },
  });
  if (!grant) {
    throw new Error("Forbidden: missing MANUAL_ADJUSTMENT permission.");
  }
}

export class LedgerTransactionNotFoundError extends Error {
  constructor(idempotencyKey: string) {
    super(`No ledger entries found for idempotency key "${idempotencyKey}".`);
    this.name = "LedgerTransactionNotFoundError";
  }
}

export class AlreadyReversedError extends Error {
  constructor(idempotencyKey: string) {
    super(`Transaction "${idempotencyKey}" has already been reversed.`);
    this.name = "AlreadyReversedError";
  }
}

/** Deterministic, so a reversal of the same original transaction can never
 * be double-posted — postTransaction's own idempotency guard on this key
 * is what actually enforces "at most one reversal per original transaction",
 * not just the pre-check in reverseLedgerTransaction below. */
function reversalIdempotencyKey(originalIdempotencyKey: string): string {
  return `manual_adjustment:${originalIdempotencyKey}`;
}

export type LedgerTransactionRow = {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  wallet: Wallet;
  direction: "CREDIT" | "DEBIT";
  amount: string;
  entryType: string;
  comment: string | null;
  createdAt: Date;
};

/**
 * The "search/select a ledger entry to reverse" lookup (SCRUM-111): given
 * one entry's id, returns every row sharing its idempotencyKey — the
 * WHOLE original transaction, not just the one row the admin clicked.
 * postTransaction always writes entries in balanced pairs/groups sharing
 * one idempotencyKey, so reversing correctly requires seeing (and later
 * reversing) every sibling, not just the selected row — reversing only
 * one side would itself be unbalanced and rejected by postTransaction.
 * MANUAL_ADJUSTMENT-gated (main admin bypass); this is an admin browsing
 * arbitrary users' ledger history by design, so invariant #9's
 * self-ownership rule does not apply here (same posture as searchUsers).
 */
export async function findLedgerTransactionByEntryId(
  actingAdminId: string,
  entryId: string,
): Promise<LedgerTransactionRow[]> {
  await assertHasManualAdjustmentPermission(actingAdminId);

  const selected = await prisma.ledgerEntry.findUnique({ where: { id: entryId } });
  if (!selected) {
    throw new Error(`No ledger entry found with id "${entryId}".`);
  }

  const siblings = await prisma.ledgerEntry.findMany({
    where: { idempotencyKey: selected.idempotencyKey },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { name: true, email: true } } },
  });

  return siblings.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.user?.name ?? null,
    userEmail: row.user?.email ?? null,
    wallet: row.wallet,
    direction: row.direction,
    amount: row.amount.toString(),
    entryType: row.entryType,
    comment: row.comment,
    createdAt: row.createdAt,
  }));
}

const reverseLedgerTransactionInputSchema = z.object({
  idempotencyKey: z.string().min(1),
  reason: z.string().min(1, "A reason is required to reverse a transaction."),
});

export type ReverseLedgerTransactionInput = z.infer<typeof reverseLedgerTransactionInputSchema>;

/**
 * Posts a NEW, equal-and-opposite ledger entry for every row in the
 * original transaction (identified by `idempotencyKey`) — never edits or
 * deletes the original rows (invariant #2: no ledger UPDATE/DELETE, ever).
 * This is the only write path here; everything goes through
 * postTransaction, per the ticket's explicit "do not create any new direct
 * DB write path" constraint.
 *
 * Each reversal entry mirrors its original's wallet/userId exactly, with
 * the opposite `direction` — this is what keeps the new transaction
 * balanced overall (the original group already balanced debits==credits,
 * so flipping every entry's direction balances it again) without needing
 * to reconstruct the original economic logic. `entryType` is always
 * ADMIN_ADJUSTMENT (the ledger's own vocabulary for this), `referenceType`/
 * `referenceId` point back at the original transaction's idempotencyKey so
 * the connection is traceable from the ledger row itself, not just from
 * admin_actions.
 *
 * Refuses (nothing written) if: no reason given; no entries exist for
 * `idempotencyKey` (LedgerTransactionNotFoundError); this transaction has
 * already been reversed (AlreadyReversedError, checked up front — the real
 * backstop is still postTransaction's own idempotency guard on the
 * deterministic reversal key, this is just a clearer error than a silent
 * `alreadyProcessed: true`).
 */
export async function reverseLedgerTransaction(actingAdminId: string, input: ReverseLedgerTransactionInput) {
  const data = reverseLedgerTransactionInputSchema.parse(input);
  await assertHasManualAdjustmentPermission(actingAdminId);

  const originalEntries = await prisma.ledgerEntry.findMany({
    where: { idempotencyKey: data.idempotencyKey },
  });
  if (originalEntries.length === 0) {
    throw new LedgerTransactionNotFoundError(data.idempotencyKey);
  }

  const reversalKey = reversalIdempotencyKey(data.idempotencyKey);
  const alreadyReversed = await prisma.ledgerEntry.findFirst({ where: { idempotencyKey: reversalKey } });
  if (alreadyReversed) {
    throw new AlreadyReversedError(data.idempotencyKey);
  }

  return prisma.$transaction(async (tx) => {
    const result = await postTransaction(
      {
        entries: originalEntries.map((entry) => ({
          userId: entry.userId,
          wallet: entry.wallet,
          direction: entry.direction === "CREDIT" ? "DEBIT" : "CREDIT",
          amount: entry.amount,
          entryType: "ADMIN_ADJUSTMENT",
          referenceType: "manual_adjustment",
          referenceId: data.idempotencyKey,
          comment: data.reason,
        })),
        idempotencyKey: reversalKey,
      },
      tx,
    );

    if (result.alreadyProcessed) {
      return result;
    }

    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "MANUAL_ADJUSTMENT_POSTED",
        reason: data.reason,
      },
    });

    return result;
  });
}

const DEFAULT_RECENT_ADJUSTMENTS_LIMIT = 20;

/**
 * The last N manual adjustments (default 20), newest first — mirrors
 * listRecentCreditIssuances exactly. Reads admin_actions directly (not
 * ledger_entries) since actionType/reason/admin/createdAt are all already
 * there in one row. MANUAL_ADJUSTMENT-gated (main admin bypass).
 */
export async function listRecentManualAdjustments(
  actingAdminId: string,
  limit: number = DEFAULT_RECENT_ADJUSTMENTS_LIMIT,
) {
  await assertHasManualAdjustmentPermission(actingAdminId);

  const actions = await prisma.adminAction.findMany({
    where: { actionType: "MANUAL_ADJUSTMENT_POSTED" },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      admin: { select: { name: true, email: true } },
    },
  });

  return actions.map((a) => ({
    id: a.id,
    adminName: a.admin.name,
    reason: a.reason,
    createdAt: a.createdAt,
  }));
}
