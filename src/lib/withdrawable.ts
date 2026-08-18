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
 * Wallet C's withdrawable commission: the full C balance minus anything
 * still sitting in the SAVING wallet. The SAVING wallet row already exists
 * per-user (created at signup) but nothing credits it until SCRUM-58 builds
 * the saving_lots unlock job — so this is currently always C's full balance,
 * and will automatically stay correct once SCRUM-58 lands with no change
 * needed here, since it reads the live WalletAccount balance rather than
 * assuming zero.
 */
export async function withdrawableC(userId: string): Promise<Prisma.Decimal> {
  const [walletC, walletSaving] = await Promise.all([
    prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId, type: "C" } } }),
    prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId, type: "SAVING" } } }),
  ]);

  const withdrawable = new Prisma.Decimal(walletC.balance).sub(walletSaving.balance);
  return Prisma.Decimal.max(withdrawable, new Prisma.Decimal(0));
}
