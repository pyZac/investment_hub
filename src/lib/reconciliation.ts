import { Prisma, type Wallet } from "@prisma/client";
import { prisma } from "./prisma";

export type WalletMismatch = {
  userId: string;
  wallet: Wallet;
  ledgerSum: string;
  cachedBalance: string;
  drift: string;
};

export type SystemExternalMismatch = {
  totalUserBalances: string;
  systemExternalLedgerNet: string;
  drift: string;
};

export type ReconciliationReport = {
  clean: boolean;
  walletMismatches: WalletMismatch[];
  systemExternalMismatch: SystemExternalMismatch | null;
};

function ledgerNet(rows: { direction: "CREDIT" | "DEBIT"; amount: Prisma.Decimal }[]) {
  return rows.reduce((sum, row) => {
    const signed = row.direction === "CREDIT" ? row.amount : row.amount.neg();
    return sum.add(signed);
  }, new Prisma.Decimal(0));
}

/**
 * Asserts SUM(ledger) == WalletAccount.balance for every real user/wallet,
 * plus the global solvency identity for SYSTEM_EXTERNAL: since every ledger
 * entry is double-sided, SYSTEM_EXTERNAL's net ledger position must always be
 * the exact negative of every real user's combined cached balance (Decision 1
 * — money only exists in the system if it entered via SYSTEM_EXTERNAL).
 *
 * Drift is treated as a potential tampering signal, not merely a bug signal
 * (per the phase-12 framing) — this throws loudly rather than logging
 * silently. Scheduling and persistent alarm delivery belong to Phase 12; this
 * is the check itself.
 */
export async function runReconciliation(): Promise<ReconciliationReport> {
  const wallets = await prisma.walletAccount.findMany();
  const walletMismatches: WalletMismatch[] = [];

  for (const wallet of wallets) {
    const entries = await prisma.ledgerEntry.findMany({
      where: { userId: wallet.userId, wallet: wallet.type },
      select: { direction: true, amount: true },
    });
    const ledgerSum = ledgerNet(entries);
    const cachedBalance = new Prisma.Decimal(wallet.balance);

    if (!ledgerSum.eq(cachedBalance)) {
      walletMismatches.push({
        userId: wallet.userId,
        wallet: wallet.type,
        ledgerSum: ledgerSum.toString(),
        cachedBalance: cachedBalance.toString(),
        drift: ledgerSum.sub(cachedBalance).toString(),
      });
    }
  }

  const totalUserBalances = wallets.reduce(
    (sum, w) => sum.add(w.balance),
    new Prisma.Decimal(0),
  );

  const systemExternalEntries = await prisma.ledgerEntry.findMany({
    where: { wallet: "SYSTEM_EXTERNAL" },
    select: { direction: true, amount: true },
  });
  const systemExternalLedgerNet = ledgerNet(systemExternalEntries);

  // Every entry touching SYSTEM_EXTERNAL has an equal-and-opposite entry on a
  // real user's wallet, so the two totals must be exact negatives of each other.
  let systemExternalMismatch: SystemExternalMismatch | null = null;
  if (!totalUserBalances.add(systemExternalLedgerNet).isZero()) {
    systemExternalMismatch = {
      totalUserBalances: totalUserBalances.toString(),
      systemExternalLedgerNet: systemExternalLedgerNet.toString(),
      drift: totalUserBalances.add(systemExternalLedgerNet).toString(),
    };
  }

  const report: ReconciliationReport = {
    clean: walletMismatches.length === 0 && systemExternalMismatch === null,
    walletMismatches,
    systemExternalMismatch,
  };

  if (!report.clean) {
    const lines: string[] = [];
    for (const m of walletMismatches) {
      lines.push(
        `user=${m.userId} wallet=${m.wallet}: ledger sum=${m.ledgerSum}, cached balance=${m.cachedBalance}, drift=${m.drift}`,
      );
    }
    if (systemExternalMismatch) {
      lines.push(
        `SYSTEM_EXTERNAL: total user balances=${systemExternalMismatch.totalUserBalances}, ` +
          `SYSTEM_EXTERNAL ledger net=${systemExternalMismatch.systemExternalLedgerNet}, ` +
          `drift=${systemExternalMismatch.drift}`,
      );
    }
    throw new Error(`Reconciliation FAILED — ${lines.length} mismatch(es):\n${lines.join("\n")}`);
  }

  return report;
}
