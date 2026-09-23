import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { dailyRate } from "./interest-rate";

async function assertHasSolvencyViewPermission(actingAdminId: string): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }
  if (admin.isMainAdmin) {
    return;
  }
  const grant = await prisma.adminPermissionGrant.findUnique({
    where: { adminUserId_permission: { adminUserId: actingAdminId, permission: "SOLVENCY_VIEW" } },
  });
  if (!grant) {
    throw new Error("Forbidden: missing SOLVENCY_VIEW permission.");
  }
}

const PROJECTION_DAYS = 30;

export type SolvencyOverview = {
  totalCreditIssued: Prisma.Decimal;
  totalLiabilities: Prisma.Decimal;
  liabilitiesBreakdown: {
    walletA: Prisma.Decimal;
    walletB: Prisma.Decimal;
    walletC: Prisma.Decimal;
    walletSaving: Prisma.Decimal;
  };
  /** null when totalLiabilities is 0 — a ratio against zero liabilities is
   * undefined, not infinite-and-therefore-healthy or 0-and-therefore-alarming. */
  solvencyRatio: Prisma.Decimal | null;
  projectedLiabilities30d: Prisma.Decimal;
};

/**
 * The admin panel's solvency dashboard (SCRUM-113, docs/build_plan.md
 * Part 5). SOLVENCY_VIEW-gated (main admin bypass). Every number here is a
 * direct aggregation over ledger_entries/wallets, plus one read of the
 * existing dailyRate() function for the projection — no new financial/
 * business logic is introduced by this file, per the ticket's own "no new
 * financial logic, just aggregation and display" constraint.
 *
 * `totalCreditIssued`: SUM of every ADMIN_CREDIT ledger entry's CREDIT
 * side only (adminCreditWalletB's real entryType — NOT the AdminActionType
 * enum value CREDIT_ISSUANCE, which is a different table's log of the same
 * action, not itself a ledger row). Every ADMIN_CREDIT entry is written as
 * a balanced pair (user CREDIT + SYSTEM_EXTERNAL DEBIT) — filtering to
 * `direction: "CREDIT"` is required, not optional: summing both sides
 * unfiltered would net to zero, since the SYSTEM_EXTERNAL DEBIT side
 * exactly cancels the CREDIT side amount-for-amount (same class of mistake
 * flagged in the Phase 4 SCRUM-54 lesson about direction-filtered ledger
 * aggregates).
 *
 * `totalLiabilities`: what the platform actually owes users right now —
 * simply the sum of every real user's wallet balance across A/B/C/SAVING
 * (excluding SYSTEM_EXTERNAL, which is not a real user). build_plan.md
 * Part 5's wording ("wallet balances + locked capital + pending saving
 * lots") first read as two ADDITIONAL pools beyond wallet balances —
 * `Investment.amount` (locked until capitalReleasedAt) and
 * `SavingLot.amount` (locked until releasedAt) — but tracing
 * purchasePackage/direct-commission.ts/capital-release.ts shows both are
 * metadata alongside money that is ALREADY inside a wallet balance:
 * purchasePackage credits the full principal directly into Wallet A at
 * purchase time (capital release later is literally "A -> B", per
 * wallet_interest_audit_rules_log.md's own words — the same money moving,
 * not new money appearing), and Direct Commission's 3% saving split
 * simultaneously credits a SAVING wallet balance AND creates a SavingLot
 * row for the identical amount (the row tracks the unlock date; the
 * wallet balance IS the money). Adding either on top of wallet balances
 * double-counts real money that's already summed once — confirmed by a
 * test that traced a real purchase's exact liability delta and caught
 * exactly this double-count before it shipped. "Locked capital"/"pending
 * saving lots" describe MOVEMENT RESTRICTIONS on money already inside a
 * wallet balance, not separate ledger locations.
 *
 * `solvencyRatio`: totalCreditIssued / totalLiabilities. Null (not 0, not
 * Infinity) when liabilities are exactly zero — a genuinely undefined
 * ratio, not a value implying either perfect health or total insolvency.
 *
 * `projectedLiabilities30d`: a deliberately ROUGH estimate — the current
 * total Wallet A balance across all users compounded forward 30 days at
 * today's active `dailyRate`, i.e. `currentTotal * (1 + dailyRate)^30`.
 * This does NOT reproduce the real daily-interest engine's Friday-pause or
 * 7-day initial-delay behavior — a true simulation would duplicate real
 * business logic (accrueDailyInterestForInvestment's own day-by-day
 * walk), which this ticket explicitly does not want. Labeled as an
 * estimate in the UI for exactly this reason.
 *
 * Bug history: this formula itself was always correct — the bug was
 * upstream, in `dailyRate()` returning a percentage-scale number (e.g.
 * 0.1923 for a 5%-monthly config, meaning "0.1923%") without the final
 * `/100` every other rate consumer in this codebase applies
 * (direct-commission.ts, binary-cycle.ts both do `mul(rate).div(100)`).
 * Compounding that undivided value via `(1 + rate)^30` computed
 * `(1.1923)^30`, i.e. treated the daily rate as 19.23% per day instead of
 * 0.1923% per day — a $73,000 Wallet A total projected to ~$14.28M instead
 * of ~$77,300. Fixed at the source in `dailyRate()` itself (interest-rate.ts)
 * rather than here, since `accrueDailyInterestForInvestment` — the real
 * engine that actually credits user wallets — consumed the same
 * undivided value and had the identical bug in every live DAILY_INTEREST
 * ledger entry it has ever posted.
 */
export async function getSolvencyOverview(actingAdminId: string, forDate: Date): Promise<SolvencyOverview> {
  await assertHasSolvencyViewPermission(actingAdminId);

  const [creditEntries, wallets, rate] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { entryType: "ADMIN_CREDIT", direction: "CREDIT" },
      select: { amount: true },
    }),
    prisma.walletAccount.findMany({
      where: { type: { not: "SYSTEM_EXTERNAL" } },
      select: { type: true, balance: true },
    }),
    dailyRate(forDate),
  ]);

  const zero = new Prisma.Decimal(0);
  const totalCreditIssued = creditEntries.reduce((sum, e) => sum.add(e.amount), zero);

  const sumByWallet = (type: "A" | "B" | "C" | "SAVING") =>
    wallets.filter((w) => w.type === type).reduce((sum, w) => sum.add(w.balance), zero);

  const walletA = sumByWallet("A");
  const walletB = sumByWallet("B");
  const walletC = sumByWallet("C");
  const walletSaving = sumByWallet("SAVING");
  const totalLiabilities = walletA.add(walletB).add(walletC).add(walletSaving);

  const solvencyRatio = totalLiabilities.isZero() ? null : totalCreditIssued.div(totalLiabilities);

  const growthFactor = new Prisma.Decimal(1).add(rate).pow(PROJECTION_DAYS);
  const projectedLiabilities30d = walletA.mul(growthFactor);

  return {
    totalCreditIssued,
    totalLiabilities,
    liabilitiesBreakdown: { walletA, walletB, walletC, walletSaving },
    solvencyRatio,
    projectedLiabilities30d,
  };
}
