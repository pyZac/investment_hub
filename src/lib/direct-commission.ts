import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/**
 * Pays Direct Commission on every qualifying purchase: 5% (or the currently
 * configured split) to the direct sponsor's Wallet C, immediately available,
 * and 3% (or the currently configured split) to the sponsor's SAVING wallet,
 * locked in a new `saving_lot` for 3 months. One level only — no propagation
 * past the direct sponsor, per docs/mlm_rules_log.md Section 4.
 *
 * Changed 2026-09-24: previously gated to the buyer's first-ever purchase
 * only (via a now-removed `isDirectCommissionTriggerPurchase` check); now
 * pays on every purchase, including reinvestments. Deliberate business-rule
 * change, not a bug fix — confirmed with the project owner. Does NOT
 * retroactively pay commission for purchases made before this change; only
 * purchases processed from this point forward trigger it (no backfill).
 *
 * A no-op (not an error) in every case where no commission is owed: the
 * buyer has no sponsor, or either party is suspended. These are all
 * ordinary outcomes — not failure conditions.
 *
 * Direct Commission is new money materializing for the sponsor, not a
 * transfer out of the buyer's own balance (the buyer already paid full price
 * via purchasePackage's separate B->A entries) — so, matching
 * adminCreditWalletB's pattern, both credits are balanced against
 * SYSTEM_EXTERNAL. The two splits are written as two postTransaction calls
 * with distinct, deterministically-derived keys (`direct:{investmentId}:c`
 * and `direct:{investmentId}:saving`), NOT a single call sharing one bare
 * `direct:{investmentId}` key across all 4 entries — the ledger's
 * idempotency uniqueness is (key, user, wallet, direction), and both splits'
 * SYSTEM_EXTERNAL sides are userId: null / wallet: SYSTEM_EXTERNAL /
 * direction: DEBIT, so under one shared key they'd collide with each other,
 * not just with a genuine replay. Both calls run inside this function's own
 * transaction, so a crash between them still leaves the whole operation
 * atomic and safely retriable — a partial retry re-hits each call's own
 * idempotency guard independently.
 *
 * Takes `forDate` as a parameter (invariant #4) — used both for the
 * commission_config lookup and as the saving_lot's `unlocksAt` base.
 *
 * Opens its own transaction. For callers that must commit this atomically
 * with other writes in the same transaction (e.g. purchasePackage, so a
 * purchase and its resulting commission either both succeed or both fail
 * together — see SCRUM-66), use payDirectCommissionInTx directly with the
 * caller's own `tx` instead of this wrapper.
 */
export async function payDirectCommission(investmentId: string, forDate: Date): Promise<void> {
  await prisma.$transaction((tx) => payDirectCommissionInTx(investmentId, forDate, tx));
}

/**
 * The transactional body of payDirectCommission, exposed separately so a
 * caller that already holds its own `tx` (purchasePackage) can compose this
 * atomically with its own writes instead of opening a second, independent
 * transaction. See payDirectCommission's docstring for the full behavior
 * this implements — this function IS that behavior; payDirectCommission is
 * just this plus its own transaction wrapper.
 */
export async function payDirectCommissionInTx(
  investmentId: string,
  forDate: Date,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const investment = await tx.investment.findUniqueOrThrow({
    where: { id: investmentId },
    select: { id: true, userId: true, amount: true },
  });

  const buyer = await tx.user.findUniqueOrThrow({ where: { id: investment.userId } });
  if (!buyer.sponsorId) {
    return;
  }
  if (buyer.suspendedAt) {
    return;
  }

  const sponsor = await tx.user.findUniqueOrThrow({ where: { id: buyer.sponsorId } });
  if (sponsor.suspendedAt) {
    return;
  }

  const config = await tx.commissionConfig.findFirstOrThrow({ where: { effectiveTo: null } });

  // directCommissionSplit/directSavingSplit are percentages OF directRate
  // (must sum to 100 — enforced by commission-config.ts's admin-facing
  // write path, SCRUM-109), not independent percentages of the investment
  // amount directly — e.g. directRate=8, split=62.5/37.5 means 8% * 62.5% =
  // 5% and 8% * 37.5% = 3% of the investment amount.
  const amount = new Prisma.Decimal(investment.amount);
  const directAmount = amount.mul(config.directRate).div(100);
  const commissionAmount = directAmount.mul(config.directCommissionSplit).div(100);
  const savingAmount = directAmount.mul(config.directSavingSplit).div(100);

  const comment = `Direct Commission for investment ${investmentId}.`;

  const commissionResult = await postTransaction(
    {
      entries: [
        {
          userId: sponsor.id,
          wallet: "C",
          direction: "CREDIT",
          amount: commissionAmount,
          entryType: "DIRECT_COMMISSION",
          referenceType: "investment",
          referenceId: investmentId,
          comment,
        },
        {
          userId: null,
          wallet: "SYSTEM_EXTERNAL",
          direction: "DEBIT",
          amount: commissionAmount,
          entryType: "DIRECT_COMMISSION",
          referenceType: "investment",
          referenceId: investmentId,
          comment,
        },
      ],
      idempotencyKey: `direct:${investmentId}:c`,
    },
    tx,
  );

  const savingResult = await postTransaction(
    {
      entries: [
        {
          userId: sponsor.id,
          wallet: "SAVING",
          direction: "CREDIT",
          amount: savingAmount,
          entryType: "DIRECT_SAVING",
          referenceType: "investment",
          referenceId: investmentId,
          comment,
        },
        {
          userId: null,
          wallet: "SYSTEM_EXTERNAL",
          direction: "DEBIT",
          amount: savingAmount,
          entryType: "DIRECT_SAVING",
          referenceType: "investment",
          referenceId: investmentId,
          comment,
        },
      ],
      idempotencyKey: `direct:${investmentId}:saving`,
    },
    tx,
  );

  if (commissionResult.alreadyProcessed && savingResult.alreadyProcessed) {
    return;
  }

  const existingLot = await tx.savingLot.findFirst({ where: { sourceInvestmentId: investmentId } });
  if (existingLot) {
    return;
  }

  await tx.savingLot.create({
    data: {
      userId: sponsor.id,
      amount: savingAmount,
      sourceInvestmentId: investmentId,
      unlocksAt: addMonths(forDate, 3),
    },
  });
}

/**
 * A sponsor's own Direct Commission history — every DIRECT_COMMISSION and
 * DIRECT_SAVING ledger entry credited to their wallets, newest first.
 * Filtered to `direction: "CREDIT"` only: each commission payout also
 * writes a paired SYSTEM_EXTERNAL DEBIT row sharing the same
 * referenceType/referenceId (see the ledger's double-entry convention,
 * tasks/lessons.md), which is not part of "the sponsor's own history" and
 * would otherwise double the visible entries. Ownership is enforced by
 * construction — userId is the only filter, no separate target-user param
 * exists to view someone else's commission history (invariant #9).
 */
export async function listDirectCommissionHistoryForUser(userId: string) {
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      userId,
      direction: "CREDIT",
      entryType: { in: ["DIRECT_COMMISSION", "DIRECT_SAVING"] },
    },
    orderBy: { createdAt: "desc" },
  });

  return entries.map((entry) => ({
    id: entry.id,
    wallet: entry.wallet,
    direction: entry.direction,
    amount: entry.amount,
    investmentId: entry.referenceId,
    createdAt: entry.createdAt,
  }));
}
