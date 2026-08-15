import { Prisma, type LedgerDirection, type LedgerEntryType, type Wallet } from "@prisma/client";
import { prisma } from "./prisma";

export type PostTransactionEntry = {
  userId: string | null;
  wallet: Wallet;
  direction: LedgerDirection;
  amount: Prisma.Decimal.Value;
  entryType: LedgerEntryType;
  referenceType?: string;
  referenceId?: string;
  comment: string;
  metadata?: Prisma.InputJsonValue;
};

export type PostTransactionInput = {
  entries: PostTransactionEntry[];
  idempotencyKey: string;
};

/**
 * The only path by which money moves in this system. Validates that debits
 * equal credits, then writes every ledger entry and updates each entry's
 * cached WalletAccount balance, all inside one DB transaction.
 *
 * Idempotent: every row this call writes shares idempotencyKey. A replay with
 * the same key is detected up front and returns without writing or touching
 * any balance again. The DB's composite unique index on ledger_entries
 * (idempotency_key, user_id, wallet, direction) is the actual backstop against
 * a concurrent duplicate call racing past that check.
 *
 * Pass `tx` when the caller needs this write to be atomic with other writes
 * (e.g. an admin_actions audit row) — otherwise a new transaction is opened.
 */
export async function postTransaction(input: PostTransactionInput, tx?: Prisma.TransactionClient) {
  if (input.entries.length < 2) {
    throw new Error("postTransaction requires at least two entries (a debit side and a credit side).");
  }
  for (const entry of input.entries) {
    if (!entry.comment.trim()) {
      throw new Error("Every ledger entry requires a non-empty comment.");
    }
    if (entry.wallet === "SYSTEM_EXTERNAL" && entry.userId !== null) {
      throw new Error("SYSTEM_EXTERNAL entries must have a null userId.");
    }
    if (entry.wallet !== "SYSTEM_EXTERNAL" && entry.userId === null) {
      throw new Error("Only SYSTEM_EXTERNAL entries may have a null userId.");
    }
  }

  const zero = new Prisma.Decimal(0);
  const totalDebits = input.entries
    .filter((e) => e.direction === "DEBIT")
    .reduce((sum, e) => sum.add(e.amount), zero);
  const totalCredits = input.entries
    .filter((e) => e.direction === "CREDIT")
    .reduce((sum, e) => sum.add(e.amount), zero);

  if (!totalDebits.eq(totalCredits)) {
    throw new Error(
      `postTransaction rejected: debits (${totalDebits.toString()}) must equal credits (${totalCredits.toString()}).`,
    );
  }

  if (tx) {
    return writeEntries(input, tx);
  }
  return prisma.$transaction((tx) => writeEntries(input, tx));
}

async function writeEntries(input: PostTransactionInput, tx: Prisma.TransactionClient) {
  const existing = await tx.ledgerEntry.findFirst({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existing) {
    return { alreadyProcessed: true as const };
  }

  const created = [];
  for (const entry of input.entries) {
    const row = await tx.ledgerEntry.create({
      data: {
        userId: entry.userId,
        wallet: entry.wallet,
        direction: entry.direction,
        amount: entry.amount,
        entryType: entry.entryType,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        comment: entry.comment,
        idempotencyKey: input.idempotencyKey,
        metadata: entry.metadata,
      },
    });
    created.push(row);

    if (entry.userId !== null) {
      const delta =
        entry.direction === "CREDIT" ? new Prisma.Decimal(entry.amount) : new Prisma.Decimal(entry.amount).neg();
      await tx.walletAccount.update({
        where: { userId_type: { userId: entry.userId, type: entry.wallet } },
        data: { balance: { increment: delta } },
      });
    }
  }

  return { alreadyProcessed: false as const, entries: created };
}
