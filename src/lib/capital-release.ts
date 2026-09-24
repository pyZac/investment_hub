import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";
import { assertFriday } from "./withdrawal-guard";
import { AccountSuspendedError } from "./transfers";

export class InvestmentNotOwnedError extends Error {
  constructor() {
    super("This investment does not belong to the requesting user.");
    this.name = "InvestmentNotOwnedError";
  }
}

export class CapitalStillLockedError extends Error {
  constructor() {
    super("Capital is still locked; the 6-month lock has not yet expired.");
    this.name = "CapitalStillLockedError";
  }
}

export class CapitalAlreadyReleasedError extends Error {
  constructor() {
    super("This investment's capital has already been released.");
    this.name = "CapitalAlreadyReleasedError";
  }
}

/**
 * Self-service, instant, no-approval release of an investment's principal
 * (capital only, never accrued profit) from Wallet A into Wallet B, once its
 * 6-month lock has expired. User-initiated — never automatic. Same
 * Friday-only rule as A->B/C->B self-service transfers; no separate admin
 * approval for this step (approval only applies at the final Wallet B exit).
 *
 * On release, the investment's status flips to CAPITAL_RELEASED, which
 * `accrueDailyInterestForInvestment` checks directly — so this investment
 * permanently stops earning from this call onward, not just because a job
 * happens to filter it out.
 */
export async function releaseCapital(userId: string, investmentId: string, forDate: Date) {
  await assertFriday(forDate);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.suspendedAt !== null) {
    throw new AccountSuspendedError();
  }

  const investment = await prisma.investment.findUniqueOrThrow({ where: { id: investmentId } });
  if (investment.userId !== userId) {
    throw new InvestmentNotOwnedError();
  }
  if (investment.status !== "ACTIVE") {
    throw new CapitalAlreadyReleasedError();
  }
  if (forDate < investment.capitalUnlocksAt) {
    throw new CapitalStillLockedError();
  }

  const idempotencyKey = `capital_release:${investment.id}`;
  const comment = `Capital release for investment ${investment.id}.`;

  return prisma.$transaction(async (tx) => {
    const result = await postTransaction(
      {
        entries: [
          {
            userId,
            wallet: "A",
            direction: "DEBIT",
            amount: investment.amount,
            entryType: "CAPITAL_RELEASE",
            referenceType: "investment",
            referenceId: investment.id,
            comment,
          },
          {
            userId,
            wallet: "B",
            direction: "CREDIT",
            amount: investment.amount,
            entryType: "CAPITAL_RELEASE",
            referenceType: "investment",
            referenceId: investment.id,
            comment,
          },
        ],
        idempotencyKey,
      },
      tx,
    );

    const updated = await tx.investment.update({
      where: { id: investment.id },
      data: {
        status: "CAPITAL_RELEASED",
        capitalReleasedAt: forDate,
      },
    });

    return { investment: updated, alreadyProcessed: result.alreadyProcessed };
  });
}
