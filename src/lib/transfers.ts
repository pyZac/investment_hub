import { randomUUID } from "node:crypto";
import { Prisma, type TransferFromWallet } from "@prisma/client";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";
import { assertFriday } from "./withdrawal-guard";
import { withdrawableC, withdrawableProfitA } from "./withdrawable";

export class InsufficientWithdrawableBalanceError extends Error {
  constructor() {
    super("Amount exceeds the withdrawable balance.");
    this.name = "InsufficientWithdrawableBalanceError";
  }
}

export class AccountSuspendedError extends Error {
  constructor() {
    super("This account is suspended; withdrawals and transfers are blocked.");
    this.name = "AccountSuspendedError";
  }
}

async function transfer(
  userId: string,
  fromWallet: TransferFromWallet,
  amount: Prisma.Decimal.Value,
  forDate: Date,
  withdrawable: () => Promise<Prisma.Decimal>,
  comment: string,
  requiresFriday: boolean,
) {
  if (requiresFriday) {
    assertFriday(forDate);
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.suspendedAt !== null) {
    throw new AccountSuspendedError();
  }

  const requestedAmount = new Prisma.Decimal(amount);
  if (!requestedAmount.isPositive()) {
    throw new Error("Transfer amount must be greater than zero.");
  }

  const available = await withdrawable();
  if (requestedAmount.gt(available)) {
    throw new InsufficientWithdrawableBalanceError();
  }

  const idempotencyKey = `transfer:${fromWallet}:${userId}:${randomUUID()}`;

  return prisma.$transaction(async (tx) => {
    const result = await postTransaction(
      {
        entries: [
          {
            userId,
            wallet: fromWallet,
            direction: "DEBIT",
            amount: requestedAmount,
            entryType: "WITHDRAWAL_OUT",
            referenceType: "wallet_transfer",
            comment,
          },
          {
            userId,
            wallet: "B",
            direction: "CREDIT",
            amount: requestedAmount,
            entryType: "WITHDRAWAL_IN",
            referenceType: "wallet_transfer",
            comment,
          },
        ],
        idempotencyKey,
      },
      tx,
    );

    if (result.alreadyProcessed) {
      return result;
    }

    await tx.walletTransfer.create({
      data: {
        userId,
        fromWallet,
        amount: requestedAmount,
        requestedAt: forDate,
        processedAt: forDate,
        idempotencyKey,
      },
    });

    return result;
  });
}

/**
 * Self-service, instant, no-approval transfer of profit out of Wallet A into
 * Wallet B. Withdrawable amount excludes locked capital (see
 * `withdrawableProfitA`) — capital itself is never moved by this function.
 * Friday-only (Asia/Dubai), enforced server-side via `assertFriday`.
 */
export async function transferAtoB(userId: string, amount: Prisma.Decimal.Value, forDate: Date) {
  return transfer(userId, "A", amount, forDate, () => withdrawableProfitA(userId), "A→B profit withdrawal.", true);
}

/**
 * Self-service, instant, no-approval transfer of commission out of Wallet C
 * into Wallet B. Available any day of the week — the Friday-only rule
 * applies only to Wallet B exits (withdrawals out of the platform) and to
 * the A->B profit transfer above, never to this one. withdrawableC now
 * returns the full C balance (see withdrawable.ts's own fix comment).
 */
export async function transferCtoB(userId: string, amount: Prisma.Decimal.Value, forDate: Date) {
  return transfer(userId, "C", amount, forDate, () => withdrawableC(userId), "C→B commission withdrawal.", false);
}
