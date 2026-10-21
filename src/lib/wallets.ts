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
 * The business date a DAILY_INTEREST idempotency key represents — the
 * trailing `YYYY-MM-DD` segment of `daily_interest:{userId}:{investmentId}:
 * {date}` (accrueDailyInterestForInvestment's own stable key contract, see
 * daily-interest.ts). This is the ONLY reliable source for "which day does
 * this entry represent" — `createdAt` is the real wall-clock write time,
 * which is NOT the same day for every entry the real cron posts: the
 * scheduler fires at 00:05 Asia/Dubai, i.e. just after a business day has
 * fully elapsed, so the row representing day D is always physically
 * INSERTED during day D+1's own Dubai business day. Bucketing by
 * `createdAt` therefore attributes every entry to the day AFTER the one it
 * actually represents — this shipped silently because the two dates only
 * visibly diverge when the "day after" bucket would otherwise be empty
 * (e.g. a Friday, where no entry can physically be created during that
 * day's own cron run), which is exactly the symptom that surfaced it: a
 * real Oct 15 entry appearing to belong to Oct 16 instead.
 */
function businessDateFromIdempotencyKey(idempotencyKey: string): string {
  return idempotencyKey.slice(idempotencyKey.lastIndexOf(":") + 1);
}

/**
 * The amount of the most recently posted DAILY_INTEREST credit to Wallet A,
 * across all of this user's investments — for the dashboard's "last posted"
 * profit figure. Deliberately NOT "today's total": the real cron fires at
 * 00:05 Asia/Dubai, just after the day it's processing has fully elapsed, so
 * "today's accrual" reads as $0.00 for the entire business day until the cron
 * actually runs — this shows the most recent real credit instead, which is
 * never spuriously zero just because of what time it is right now.
 *
 * "Most recent" is determined by each entry's idempotency-key date (highest
 * `YYYY-MM-DD`), never `createdAt` — same reasoning as
 * `businessDateFromIdempotencyKey`'s own comment: `createdAt` is the real
 * wall-clock write time, which lags the business date it represents by one
 * Dubai day for the real cron, and can diverge arbitrarily for a backdated/
 * simulated entry (Developer Tools' "Simulate Daily Interest").
 *
 * Returns `null` if this user has no DAILY_INTEREST credit at all yet (e.g.
 * every investment is still inside its 7-day waiting period) — the caller
 * displays $0.00 for that case, same as before.
 */
export async function getLastPostedInterestCreditA(userId: string): Promise<Prisma.Decimal | null> {
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      userId,
      wallet: "A",
      direction: "CREDIT",
      entryType: "DAILY_INTEREST",
    },
    select: { amount: true, idempotencyKey: true },
  });

  if (entries.length === 0) {
    return null;
  }

  const mostRecent = entries.reduce((latest, entry) =>
    businessDateFromIdempotencyKey(entry.idempotencyKey) > businessDateFromIdempotencyKey(latest.idempotencyKey)
      ? entry
      : latest,
  );
  return mostRecent.amount;
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
 * Buckets by each entry's idempotency-key date, not `createdAt` — see
 * `businessDateFromIdempotencyKey`'s comment. Deliberately has NO
 * `createdAt` pre-filter for the same reason `getLastPostedInterestCreditA`
 * doesn't: a backdated/simulated entry's `createdAt` can be arbitrarily
 * far from the fabricated date it represents, so a `createdAt`-based
 * window could silently exclude a real, legitimately-backdated entry that
 * does belong in `[fromDate, toDate]`. Fetches every DAILY_INTEREST credit
 * for this user/wallet and filters by the parsed key date in JS — then
 * discards anything outside the requested range, so the returned map's
 * key range is still exactly `[fromDate, toDate]` regardless of how much
 * history exists outside it.
 *
 * Takes both dates as parameters and never calls `new Date()` internally
 * (invariant #4).
 */
export async function getDailyInterestHistoryA(
  userId: string,
  fromDate: Date,
  toDate: Date,
): Promise<Map<string, Prisma.Decimal>> {
  const fromKey = dubaiDayKey(startOfDubaiDay(fromDate));
  const toKey = dubaiDayKey(startOfDubaiDay(toDate));

  const entries = await prisma.ledgerEntry.findMany({
    where: {
      userId,
      wallet: "A",
      direction: "CREDIT",
      entryType: "DAILY_INTEREST",
    },
    select: { amount: true, idempotencyKey: true },
  });

  const byDay = new Map<string, Prisma.Decimal>();
  for (const entry of entries) {
    const key = businessDateFromIdempotencyKey(entry.idempotencyKey);
    if (key < fromKey || key > toKey) continue;
    const running = byDay.get(key) ?? new Prisma.Decimal(0);
    byDay.set(key, running.add(entry.amount));
  }
  return byDay;
}
