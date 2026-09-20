import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";
import { config } from "./config";
import { AccountSuspendedError } from "./transfers";

export class BelowMinimumTransferError extends Error {
  constructor() {
    super(`Transfers require a minimum of $${config.MIN_WITHDRAWAL}.`);
    this.name = "BelowMinimumTransferError";
  }
}

export class InsufficientWalletBBalanceError extends Error {
  constructor() {
    super("Amount exceeds your Wallet B balance.");
    this.name = "InsufficientWalletBBalanceError";
  }
}

export class RecipientNotFoundError extends Error {
  constructor() {
    super("Recipient not found.");
    this.name = "RecipientNotFoundError";
  }
}

export class SelfTransferError extends Error {
  constructor() {
    super("You cannot transfer to your own account.");
    this.name = "SelfTransferError";
  }
}

/**
 * Peer-to-peer, self-service, instant Wallet B transfer between two users —
 * distinct from transfers.ts's transferAtoB/transferCtoB (which move money
 * between a single user's OWN wallets). No admin approval, no Friday
 * restriction (available any day, per spec). Debits sender's Wallet B,
 * credits recipient's Wallet B, in one balanced postTransaction call.
 *
 * IDOR (invariant #9): callers must pass the caller's own authenticated id as
 * senderId — this function itself only validates that senderId resolves to a
 * real, non-suspended user and owns the balance being debited; it does not
 * re-derive senderId from a session, so the server action layer is what
 * actually enforces "you can only send from your own Wallet B," the same
 * division of responsibility as every other lib function in this project
 * (see withdrawal-requests.ts, transfers.ts).
 */
export async function transferBetweenUsers(
  senderId: string,
  recipientId: string,
  amount: Prisma.Decimal.Value,
  idempotencyKey: string,
) {
  if (senderId === recipientId) {
    throw new SelfTransferError();
  }

  const [sender, recipient] = await Promise.all([
    prisma.user.findUnique({ where: { id: senderId } }),
    prisma.user.findUnique({ where: { id: recipientId } }),
  ]);

  if (!sender) {
    throw new Error("Invalid sender: user not found.");
  }
  if (sender.suspendedAt !== null) {
    throw new AccountSuspendedError();
  }
  if (!recipient) {
    throw new RecipientNotFoundError();
  }
  if (recipient.suspendedAt !== null) {
    throw new RecipientNotFoundError();
  }

  const requestedAmount = new Prisma.Decimal(amount);
  if (requestedAmount.lt(config.MIN_WITHDRAWAL)) {
    throw new BelowMinimumTransferError();
  }

  const senderWalletB = await prisma.walletAccount.findUniqueOrThrow({
    where: { userId_type: { userId: senderId, type: "B" } },
  });
  if (requestedAmount.gt(senderWalletB.balance)) {
    throw new InsufficientWalletBBalanceError();
  }

  return postTransaction({
    entries: [
      {
        userId: senderId,
        wallet: "B",
        direction: "DEBIT",
        amount: requestedAmount,
        entryType: "USER_TRANSFER_SENT",
        referenceType: "user_transfer",
        referenceId: recipientId,
        comment: `Transfer sent to ${recipient.name} (${recipient.email}).`,
        metadata: { counterpartyId: recipientId, counterpartyName: recipient.name },
      },
      {
        userId: recipientId,
        wallet: "B",
        direction: "CREDIT",
        amount: requestedAmount,
        entryType: "USER_TRANSFER_RECEIVED",
        referenceType: "user_transfer",
        referenceId: senderId,
        comment: `Transfer received from ${sender.name} (${sender.email}).`,
        metadata: { counterpartyId: senderId, counterpartyName: sender.name },
      },
    ],
    idempotencyKey,
  });
}

const MAX_RECIPIENT_RESULTS = 10;

/**
 * Recipient search for the transfer picker. Unlike user-management.ts's
 * searchUsers (admin-gated, used for admin-panel target selection), this is
 * self-service — any authenticated user may search by name/email to find a
 * transfer recipient. Excludes the searching user themselves and suspended
 * accounts (both would fail transferBetweenUsers anyway; filtering here
 * keeps them out of the picker instead of surfacing a pickable-but-rejected
 * option).
 */
export async function searchTransferRecipients(searchingUserId: string, query: string) {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const users = await prisma.user.findMany({
    where: {
      id: { not: searchingUserId },
      suspendedAt: null,
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        { email: { contains: trimmed, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: MAX_RECIPIENT_RESULTS,
    select: { id: true, name: true, email: true },
  });

  return users;
}
