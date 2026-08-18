import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";
import { dailyRate, isFriday } from "./interest-rate";

export type AccrualSkipReason = "before_profit_start" | "friday" | "owner_suspended" | "capital_released";

export type AccrualResult =
  | { skipped: true; reason: AccrualSkipReason; alreadyProcessed?: undefined; amount?: undefined }
  | { skipped: false; alreadyProcessed: boolean; amount: Prisma.Decimal };

function dateKey(forDate: Date): string {
  // A stable YYYY-MM-DD key for the idempotency key. Business-day boundaries
  // (Friday skip, month rollover) are already resolved in Asia/Dubai terms
  // by dailyRate/isFriday before this is used, so the key only needs to be a
  // deterministic label for "this calendar day's run" — using the UTC date
  // of forDate is fine since callers always pass a business-day-aligned
  // instant (the scheduler runs at 00:05 Asia/Dubai).
  return forDate.toISOString().slice(0, 10);
}

/**
 * Accrues one day of interest for a single investment, or explains why it
 * was skipped. Takes `forDate` as a parameter and never calls `new Date()`
 * internally (invariant #4) — same function runs from the real scheduler and
 * from fabricated-date tests.
 *
 * Base for the credit is this investment's own running balance — its
 * principal (`investment.amount`) plus every DAILY_INTEREST credit already
 * posted against it (`referenceType: "investment", referenceId:
 * investment.id`) — never the user's combined Wallet A balance across all
 * their investments. This is what makes daily interest compound per
 * investment rather than per user.
 *
 * Checks `investment.status` itself (not just relying on callers to
 * pre-filter): a CAPITAL_RELEASED investment stops earning permanently, per
 * SCRUM-59 (see wallet_interest_audit_rules_log.md Section 3c). The daily
 * catch-up job also filters to ACTIVE investments before calling this at
 * all, but this function enforces the invariant independently so it holds
 * for any caller, not just the one that currently exists.
 */
export async function accrueDailyInterestForInvestment(
  investmentId: string,
  forDate: Date,
): Promise<AccrualResult> {
  const investment = await prisma.investment.findUniqueOrThrow({
    where: { id: investmentId },
    include: { user: true },
  });

  if (investment.status === "CAPITAL_RELEASED") {
    return { skipped: true, reason: "capital_released" };
  }
  if (forDate < investment.profitStartsAt) {
    return { skipped: true, reason: "before_profit_start" };
  }
  if (isFriday(forDate)) {
    return { skipped: true, reason: "friday" };
  }
  if (investment.user.suspendedAt !== null) {
    return { skipped: true, reason: "owner_suspended" };
  }

  const priorInterest = await prisma.ledgerEntry.aggregate({
    where: {
      referenceType: "investment",
      referenceId: investment.id,
      entryType: "DAILY_INTEREST",
      wallet: "A",
      direction: "CREDIT",
    },
    _sum: { amount: true },
  });
  const runningBalance = new Prisma.Decimal(investment.amount).add(
    priorInterest._sum.amount ?? new Prisma.Decimal(0),
  );

  const rate = await dailyRate(forDate);
  const amount = runningBalance.mul(rate);

  const idempotencyKey = `daily_interest:${investment.userId}:${investment.id}:${dateKey(forDate)}`;
  // 1-indexed to match wallet_interest_audit_rules_log.md's own day-counting
  // convention (purchase day = day 1, so accrual begins "day 8 onward").
  const dayNumber =
    Math.round((forDate.getTime() - investment.purchasedAt.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  // No short/sequential investment number exists in the schema (investment.id
  // is a cuid) — using "#" would misleadingly imply one. Names the investment
  // by its real id instead.
  const comment = `Daily interest for investment ${investment.id}, day ${dayNumber}.`;

  const result = await postTransaction({
    entries: [
      {
        userId: investment.userId,
        wallet: "A",
        direction: "CREDIT",
        amount,
        entryType: "DAILY_INTEREST",
        referenceType: "investment",
        referenceId: investment.id,
        comment,
      },
      {
        userId: null,
        wallet: "SYSTEM_EXTERNAL",
        direction: "DEBIT",
        amount,
        entryType: "DAILY_INTEREST",
        referenceType: "investment",
        referenceId: investment.id,
        comment,
      },
    ],
    idempotencyKey,
  });

  return { skipped: false, alreadyProcessed: result.alreadyProcessed, amount };
}
