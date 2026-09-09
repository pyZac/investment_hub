import { Prisma, type Wallet } from "@prisma/client";
import { prisma } from "./prisma";
import { DAY_MS, dubaiDayKey, startOfDubaiDay } from "./business-day";

const USER_WALLET_TYPES = ["A", "B", "C", "SAVING"] as const;
type UserWalletType = (typeof USER_WALLET_TYPES)[number];

export async function createWalletsForUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.walletAccount.createMany({
    data: USER_WALLET_TYPES.map((type) => ({ userId, type, balance: "0" })),
  });
}

export async function getWalletBalance(userId: string, type: Wallet) {
  const wallet = await prisma.walletAccount.findUniqueOrThrow({
    where: { userId_type: { userId, type } },
  });
  return wallet.balance;
}

/**
 * All 4 user-facing wallet balances in one query, for dashboard-style screens
 * that need every wallet at once — avoids 4 sequential/parallel
 * `getWalletBalance` round trips. Never includes SYSTEM_EXTERNAL (invariant:
 * that account is never user-facing).
 */
export async function getWalletOverview(
  userId: string,
): Promise<Record<UserWalletType, Prisma.Decimal>> {
  const wallets = await prisma.walletAccount.findMany({
    where: { userId, type: { in: [...USER_WALLET_TYPES] } },
  });

  const byType = new Map(wallets.map((w) => [w.type, w.balance]));
  const zero = new Prisma.Decimal(0);
  return {
    A: byType.get("A") ?? zero,
    B: byType.get("B") ?? zero,
    C: byType.get("C") ?? zero,
    SAVING: byType.get("SAVING") ?? zero,
  };
}

/**
 * Sum of today's DAILY_INTEREST credits to Wallet A, for the dashboard's
 * "today's profit" figure. "Today" is the business day in Asia/Dubai
 * containing `forDate`.
 *
 * Takes `forDate` as a parameter and never calls `new Date()` internally
 * (invariant #4) — same rule as every other engine/query function in this
 * project, even though this one is read-only.
 */
export async function getTodayInterestCreditA(
  userId: string,
  forDate: Date,
): Promise<Prisma.Decimal> {
  const startOfDay = startOfDubaiDay(forDate);
  const startOfNextDay = new Date(startOfDay.getTime() + DAY_MS);

  const result = await prisma.ledgerEntry.aggregate({
    where: {
      userId,
      wallet: "A",
      direction: "CREDIT",
      entryType: "DAILY_INTEREST",
      createdAt: { gte: startOfDay, lt: startOfNextDay },
    },
    _sum: { amount: true },
  });

  return result._sum.amount ?? new Prisma.Decimal(0);
}

/**
 * Day-by-day DAILY_INTEREST credits to Wallet A between `fromDate` and
 * `toDate` (inclusive of the Dubai business days containing each), for the
 * dashboard's accrual chart. One query over the whole range, bucketed into
 * per-Dubai-day sums in JS — not N per-day queries.
 *
 * Returns a Map keyed by `YYYY-MM-DD` (Dubai business day) containing only
 * days that actually have at least one credit. The caller is responsible for
 * filling in the rest of the requested range (zero-credit days, Fridays) —
 * this function only reports what's really in the ledger, since "no row
 * queried" (a Friday, where accrual cannot exist) and "queried and found
 * zero" (a real anomaly on a non-Friday) are different facts that only the
 * caller building the chart series can tell apart.
 *
 * Takes both dates as parameters and never calls `new Date()` internally
 * (invariant #4).
 */
export async function getDailyInterestHistoryA(
  userId: string,
  fromDate: Date,
  toDate: Date,
): Promise<Map<string, Prisma.Decimal>> {
  const rangeStart = startOfDubaiDay(fromDate);
  const rangeEnd = new Date(startOfDubaiDay(toDate).getTime() + DAY_MS);

  const entries = await prisma.ledgerEntry.findMany({
    where: {
      userId,
      wallet: "A",
      direction: "CREDIT",
      entryType: "DAILY_INTEREST",
      createdAt: { gte: rangeStart, lt: rangeEnd },
    },
    select: { amount: true, createdAt: true },
  });

  const byDay = new Map<string, Prisma.Decimal>();
  for (const entry of entries) {
    const key = dubaiDayKey(startOfDubaiDay(entry.createdAt));
    const running = byDay.get(key) ?? new Prisma.Decimal(0);
    byDay.set(key, running.add(entry.amount));
  }
  return byDay;
}
