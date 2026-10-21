import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";
import { payDirectCommissionInTx } from "./direct-commission";
import { rollupBvForPurchase } from "./binary-tree";
import { accrueMrvForPurchase } from "./rank";

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
 *
 * BV rollup (rollupBvForPurchase) and MRV accrual (accrueMrvForPurchase) run
 * the same way, same reasoning: same transaction, newly-created path only.
 * BV walks the placement tree (unlimited depth); MRV credits only the
 * buyer's direct sponsor (depth 1, sponsor tree) — two intentionally
 * different trees and depths, never conflate them (invariant #5).
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
    await rollupBvForPurchase(investment.id, userId, pkg.amount, data.forDate, tx);
    await accrueMrvForPurchase(userId, pkg.amount, data.forDate, tx);

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
 * A user's own ACTIVE investments only, newest first — for surfaces that
 * track in-flight lock countdowns (e.g. the dashboard's countdown-ring
 * panel), where a CAPITAL_RELEASED investment's countdown has already
 * finished and showing it would just be a "100% done" ring with nothing
 * useful to track. `listInvestmentsForUser` (unfiltered, full history
 * including released investments) remains the right call for the Phase 3
 * investments page, which is a historical ledger view, not an active-lock
 * tracker — this is a separate function rather than a filter added to that
 * one so neither caller's intent gets ambiguous.
 */
export async function listActiveInvestmentsForUser(userId: string) {
  return prisma.investment.findMany({
    where: { userId, status: "ACTIVE" },
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

export type InvestmentProfitBreakdownRow = {
  investmentId: string;
  packageName: string;
  amount: Prisma.Decimal;
  purchasedAt: Date;
  lastPostedProfit: Prisma.Decimal | null;
  totalProfit: Prisma.Decimal;
};

/**
 * Per-investment profit figures for the dashboard's breakdown section — the
 * per-investment counterpart to `getLastPostedInterestCreditA`/
 * `getDailyInterestHistoryA` (wallets.ts), which only ever aggregate across
 * ALL of a user's investments. Scoped to the caller's own ACTIVE investments
 * only (reuses `listActiveInvestmentsForUser` — ownership enforced by
 * construction, invariant #9, no separate target-user param exists here any
 * more than it does there).
 *
 * `lastPostedProfit`: the amount of the most recently posted DAILY_INTEREST
 * CREDIT for THIS investment specifically — not a sum over "today" (the real
 * cron fires at 00:05 Asia/Dubai, so "today's accrual" reads as $0.00 for the
 * entire business day until the cron actually runs). "Most recent" is
 * determined by the highest idempotency-key business date, never `createdAt`
 * — same reasoning as `wallets.ts`'s `businessDateFromIdempotencyKey`. `null`
 * if this investment has no DAILY_INTEREST credit yet (still inside its
 * 7-day waiting period) — the caller displays $0.00 for that case.
 *
 * `totalProfit`: sum of every DAILY_INTEREST CREDIT ever posted for that
 * investment, minus any reversal of one. A DAILY_INTEREST reversal (the only
 * write path is `reverseLedgerTransaction`, manual-adjustment.ts) is NOT
 * tagged `entryType: "DAILY_INTEREST"` and does NOT share the original
 * entry's `referenceType: "investment"` scoping — it's posted as
 * `entryType: "ADMIN_ADJUSTMENT"`, `referenceType: "manual_adjustment"`,
 * with `referenceId` set to the ORIGINAL transaction's idempotencyKey
 * (`daily_interest:{userId}:{investmentId}:{date}`). A plain
 * `referenceType: "investment", referenceId: investmentId` filter on
 * DAILY_INTEREST credits alone would silently miss every reversal and
 * overstate total profit for any investment a repair script has touched —
 * confirmed this is a REAL, not hypothetical, scenario in this project's own
 * history (see tasks/lessons.md, 2026-09-30 entry on investment
 * cmudeva3t000zmn01z8gr3ntx). Reversals are found by matching
 * `referenceType: "manual_adjustment"` rows whose `referenceId` starts with
 * this investment's own idempotency-key prefix, not by any shared reference
 * scope with the originals.
 *
 * No date parameter: `lastPostedProfit` is "most recent ever," not bucketed
 * relative to "now," and `totalProfit` is a lifetime sum — neither needs a
 * reference date, so none is taken (nothing left in this function would read
 * one; invariant #4's "take dates as parameters" only applies to functions
 * that actually compare against a point in time).
 */
export async function getInvestmentProfitBreakdownForUser(
  userId: string,
): Promise<InvestmentProfitBreakdownRow[]> {
  const activeInvestments = await listActiveInvestmentsForUser(userId);
  if (activeInvestments.length === 0) {
    return [];
  }

  return Promise.all(
    activeInvestments.map(async (investment) => {
      const idempotencyKeyPrefix = `daily_interest:${userId}:${investment.id}:`;

      const [creditEntries, reversalEntries] = await Promise.all([
        prisma.ledgerEntry.findMany({
          where: {
            referenceType: "investment",
            referenceId: investment.id,
            entryType: "DAILY_INTEREST",
            wallet: "A",
            direction: "CREDIT",
          },
          select: { amount: true, idempotencyKey: true },
        }),
        prisma.ledgerEntry.findMany({
          where: {
            referenceType: "manual_adjustment",
            referenceId: { startsWith: idempotencyKeyPrefix },
            wallet: "A",
            direction: "DEBIT",
          },
          select: { amount: true },
        }),
      ]);

      const zero = new Prisma.Decimal(0);
      // Picked by each entry's idempotency-key date, never `createdAt` — the
      // real cron always WRITES a day's row during the FOLLOWING Dubai
      // business day (it fires at 00:05 Asia/Dubai, just after the day it's
      // processing has fully elapsed), so `createdAt` doesn't reflect which
      // entry is really "most recent" in business-date terms. See
      // wallets.ts's `businessDateFromIdempotencyKey` for the full
      // explanation — this is the same reasoning, same fix, in the
      // per-investment counterpart to that file's `getLastPostedInterestCreditA`.
      const lastPosted =
        creditEntries.length === 0
          ? null
          : creditEntries.reduce((latest, entry) =>
              entry.idempotencyKey.slice(entry.idempotencyKey.lastIndexOf(":") + 1) >
              latest.idempotencyKey.slice(latest.idempotencyKey.lastIndexOf(":") + 1)
                ? entry
                : latest,
            ).amount;
      const totalCredited = creditEntries.reduce((sum, entry) => sum.add(entry.amount), zero);
      const totalReversed = reversalEntries.reduce((sum, entry) => sum.add(entry.amount), zero);

      return {
        investmentId: investment.id,
        packageName: investment.package.name,
        amount: investment.amount,
        purchasedAt: investment.purchasedAt,
        lastPostedProfit: lastPosted,
        totalProfit: totalCredited.sub(totalReversed),
      };
    }),
  );
}
