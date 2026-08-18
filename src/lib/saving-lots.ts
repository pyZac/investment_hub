import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";

/**
 * Releases every SAVING lot whose lock has expired as of `asOfDate`:
 * DEBIT the owner's SAVING wallet, CREDIT their C wallet, and mark the lot
 * released. Takes `asOfDate` as a parameter and never calls `new Date()`
 * internally (invariant #4) — the scheduler passes the real current date,
 * tests pass fabricated ones.
 *
 * Unlike daily interest, this isn't a periodic "catch up on missed calendar
 * days" job — a lot's release is a one-time event per lot, not something
 * that recurs per day. So there's no job_runs/period-key wrapper: idempotency
 * is per-row, via the `releasedAt IS NULL` filter (a released lot is never
 * selected again) backed by the ledger's own idempotency key as a second
 * layer of protection against a concurrent double-release.
 */
export async function releaseDueSavingLots(asOfDate: Date): Promise<void> {
  const dueLots = await prisma.savingLot.findMany({
    where: { releasedAt: null, unlocksAt: { lte: asOfDate } },
  });

  for (const lot of dueLots) {
    await releaseOneLot(lot.id, lot.userId, lot.amount, asOfDate);
  }
}

async function releaseOneLot(lotId: string, userId: string, amount: Prisma.Decimal, asOfDate: Date) {
  const idempotencyKey = `saving_unlock:${lotId}`;
  const comment = `SAVING unlock for lot ${lotId}.`;

  await prisma.$transaction(async (tx) => {
    await postTransaction(
      {
        entries: [
          {
            userId,
            wallet: "SAVING",
            direction: "DEBIT",
            amount,
            entryType: "SAVING_UNLOCK",
            referenceType: "saving_lot",
            referenceId: lotId,
            comment,
          },
          {
            userId,
            wallet: "C",
            direction: "CREDIT",
            amount,
            entryType: "SAVING_UNLOCK",
            referenceType: "saving_lot",
            referenceId: lotId,
            comment,
          },
        ],
        idempotencyKey,
      },
      tx,
    );

    await tx.savingLot.update({
      where: { id: lotId },
      data: { releasedAt: asOfDate },
    });
  });
}
