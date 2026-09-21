import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Wallet A's withdrawable profit: the full A balance minus locked capital.
 * Locked capital is the sum of `investments.amount` for every investment
 * this user has that is still ACTIVE (capital not yet released) — capital
 * that has already been released via CAPITAL_RELEASE (SCRUM-57) no longer
 * counts against the deduction, since it left this investment's principal
 * tracking the moment it was released.
 *
 * Recomputed from source (wallets + investments) on every call, per the
 * "recompute from source, never estimate a cached balance" principle — no
 * derived/cached column exists for this.
 */
export async function withdrawableProfitA(userId: string): Promise<Prisma.Decimal> {
  const wallet = await prisma.walletAccount.findUniqueOrThrow({
    where: { userId_type: { userId, type: "A" } },
  });

  const lockedCapital = await prisma.investment.aggregate({
    where: { userId, status: "ACTIVE" },
    _sum: { amount: true },
  });

  const profit = new Prisma.Decimal(wallet.balance).sub(
    lockedCapital._sum.amount ?? new Prisma.Decimal(0),
  );

  // Never negative — a corrupted/unexpected state should read as "nothing
  // withdrawable", not a negative withdrawable amount.
  return Prisma.Decimal.max(profit, new Prisma.Decimal(0));
}

/**
 * Wallet C's withdrawable commission: the full C balance. SAVING is a
 * fully separate wallet — Direct Commission credits it independently of C
 * (a distinct 3% split, direct-commission.ts), and a saving_lot's release
 * (saving-lots.ts) DEBITs SAVING and CREDITs C at that point, so SAVING
 * money never sits "inside" C waiting to be excluded. Previously this
 * function subtracted the SAVING balance from C, which double-deducted
 * money C never held — e.g. C=$50, SAVING=$30 wrongly showed only $20
 * available, when the full $50 in C was genuinely free to transfer. Fixed:
 * no subtraction, just the live C balance (never negative by construction,
 * so no floor needed, but Decimal.max kept for symmetry with
 * withdrawableProfitA's defensive pattern).
 */
export async function withdrawableC(userId: string): Promise<Prisma.Decimal> {
  const walletC = await prisma.walletAccount.findUniqueOrThrow({
    where: { userId_type: { userId, type: "C" } },
  });

  return Prisma.Decimal.max(new Prisma.Decimal(walletC.balance), new Prisma.Decimal(0));
}
