import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";

/**
 * Whether `investmentId` is the buyer's genuinely first-ever investment, by
 * purchase order — the sole trigger condition for Phase 6's Direct
 * Commission. Deliberately NOT named `isFirstPurchase`: Phase 9's MRV engine
 * also deals with "purchases by a user", but counts every purchase (no
 * first-only restriction) at one level of sponsor depth — a different
 * trigger for a different purpose (see docs/mlm_rules_log.md Section 6 and
 * docs/phases/phase-06-direct-commission.md). Never reuse this function, or
 * generalize it into something both systems share — that would silently
 * couple two rules the spec keeps intentionally independent.
 *
 * Order is determined by `purchasedAt`, tie-broken by `createdAt` (real DB
 * insertion order), tie-broken again by `id` (cuids are unique) — so two
 * investments sharing the exact same `purchasedAt` instant (e.g. fabricated
 * or backfilled dates, or a rare same-millisecond concurrent insert) still
 * resolve to exactly one deterministic "first" investment, not an ambiguous
 * or flip-flopping result across repeated calls.
 *
 * `tx` is required, not optional: the caller MUST run this inside the same
 * DB transaction as the resulting commission payout. Two concurrent first
 * purchases by the same user must not both read "I am first" — that
 * consistency only holds if this read and the payout it gates commit
 * atomically together. A convenience default to a bare `prisma` client would
 * silently reintroduce that race.
 */
export async function isDirectCommissionTriggerPurchase(
  investmentId: string,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const target = await tx.investment.findUniqueOrThrow({
    where: { id: investmentId },
    select: { id: true, userId: true },
  });

  const earliest = await tx.investment.findFirstOrThrow({
    where: { userId: target.userId },
    orderBy: [{ purchasedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  return earliest.id === target.id;
}

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/**
 * Pays Direct Commission on a qualifying first purchase: 5% (or the
 * currently configured split) to the direct sponsor's Wallet C, immediately
 * available, and 3% (or the currently configured split) to the sponsor's
 * SAVING wallet, locked in a new `saving_lot` for 3 months. One level only —
 * no propagation past the direct sponsor, per docs/mlm_rules_log.md Section 4.
 *
 * A no-op (not an error) in every case where no commission is owed: the
 * purchase isn't the buyer's first (checked via
 * isDirectCommissionTriggerPurchase — never re-derived here), the buyer has
 * no sponsor, or either party is suspended. These are all ordinary outcomes
 * — most purchases in the system are exactly this — not failure conditions.
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

  const isTrigger = await isDirectCommissionTriggerPurchase(investmentId, tx);
  if (!isTrigger) {
    return;
  }

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

  const amount = new Prisma.Decimal(investment.amount);
  const commissionAmount = amount.mul(config.directCommissionSplit).div(100);
  const savingAmount = amount.mul(config.directSavingSplit).div(100);

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
