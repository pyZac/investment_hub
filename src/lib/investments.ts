import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";
import { payDirectCommissionInTx } from "./direct-commission";

const purchasePackageInputSchema = z.object({
  packageId: z.string(),
  forDate: z.date(),
  idempotencyKey: z.string().min(1),
});

export type PurchasePackageInput = z.infer<typeof purchasePackageInputSchema>;

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/**
 * A user turns Wallet B credit into an active investment. Ownership is
 * enforced by construction: userId is always the authenticated caller, never
 * a client-supplied target (invariant #9) — there is no separate "target
 * user" parameter to purchase on someone else's behalf.
 *
 * Idempotent: the investments table carries no idempotencyKey column of its
 * own (fixed column list), so replay detection piggybacks on the ledger
 * entries this call writes — referenceType "investment" / referenceId set to
 * idempotencyKey. A replay looks up that ledger entry first and returns the
 * already-created investment rather than writing anything again.
 *
 * Direct Commission (SCRUM-66): after creating the investment, calls
 * payDirectCommissionInTx in this same transaction — not payDirectCommission
 * (which opens its own, separate transaction) and not as a follow-up call
 * after this function returns. A purchase and its resulting commission must
 * commit or roll back together: if anything after the investment write
 * fails, Prisma rolls back the entire transaction, so no half-completed
 * state (investment created but commission silently skipped, or vice versa)
 * is ever visible. Only called on the newly-created path, not the
 * already-processed replay path — a replay's commission (if any) was
 * already resolved on the original call and payDirectCommissionInTx's own
 * per-split idempotency keys would make a second call harmless but wasted.
 */
export async function purchasePackage(userId: string, input: PurchasePackageInput) {
  const data = purchasePackageInputSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const existingEntry = await tx.ledgerEntry.findFirst({
      where: { idempotencyKey: data.idempotencyKey },
    });
    if (existingEntry) {
      const investment = await tx.investment.findFirstOrThrow({
        where: { referenceId: data.idempotencyKey },
      });
      return { alreadyProcessed: true as const, investment };
    }

    const pkg = await tx.package.findUnique({ where: { id: data.packageId } });
    if (!pkg) {
      throw new Error("Invalid package: not found.");
    }
    if (!pkg.isActive) {
      throw new Error("This package is deactivated and cannot be purchased.");
    }

    const walletB = await tx.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId, type: "B" } },
    });
    if (new Prisma.Decimal(walletB.balance).lt(pkg.amount)) {
      throw new Error("Insufficient Wallet B balance for this purchase.");
    }

    await postTransaction(
      {
        entries: [
          {
            userId,
            wallet: "B",
            direction: "DEBIT",
            amount: pkg.amount,
            entryType: "PACKAGE_PURCHASE",
            referenceType: "investment",
            referenceId: data.idempotencyKey,
            comment: `Purchased package "${pkg.name}".`,
          },
          {
            userId,
            wallet: "A",
            direction: "CREDIT",
            amount: pkg.amount,
            entryType: "PACKAGE_PURCHASE",
            referenceType: "investment",
            referenceId: data.idempotencyKey,
            comment: `Purchased package "${pkg.name}".`,
          },
        ],
        idempotencyKey: data.idempotencyKey,
      },
      tx,
    );

    const investment = await tx.investment.create({
      data: {
        userId,
        packageId: pkg.id,
        amount: pkg.amount,
        purchasedAt: data.forDate,
        profitStartsAt: addDays(data.forDate, 7),
        capitalUnlocksAt: addMonths(data.forDate, 6),
        referenceId: data.idempotencyKey,
      },
    });

    await payDirectCommissionInTx(investment.id, data.forDate, tx);

    return { alreadyProcessed: false as const, investment };
  });
}

/**
 * A user's own investments, newest first. Ownership is enforced by
 * construction — userId is the only filter, no separate target-user param
 * exists to view someone else's investments (invariant #9).
 */
export async function listInvestmentsForUser(userId: string) {
  return prisma.investment.findMany({
    where: { userId },
    include: { package: true },
    orderBy: { purchasedAt: "desc" },
  });
}

/**
 * Whole days remaining until `target`, relative to `now` (explicit param per
 * invariant #4, even for display-only logic). 0 once `target` has passed —
 * callers treat 0 as "unlocked"/"started", never negative countdowns.
 */
export function daysUntil(target: Date, now: Date): number {
  const msRemaining = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
}
