import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type NegativeBalance = {
  userId: string;
  wallet: string;
  balance: string;
};

export type OrphanBinaryNode = {
  userId: string;
  reason: "parent_not_found" | "user_not_found";
  parentId: string | null;
};

export type DuplicateIdempotencyKey = {
  idempotencyKey: string;
  userId: string | null;
  wallet: string;
  direction: string;
  count: number;
};

export type InvariantCheckReport = {
  clean: boolean;
  negativeBalances: NegativeBalance[];
  orphanBinaryNodes: OrphanBinaryNode[];
  duplicateIdempotencyKeys: DuplicateIdempotencyKey[];
};

async function findNegativeBalances(): Promise<NegativeBalance[]> {
  const wallets = await prisma.walletAccount.findMany({
    where: { balance: { lt: 0 } },
  });

  return wallets.map((w) => ({
    userId: w.userId,
    wallet: w.type,
    balance: new Prisma.Decimal(w.balance).toString(),
  }));
}

/**
 * `binary_nodes.parent_id` and `.user_id` both carry FKs (RESTRICT, no
 * cascade) so a normal write path can never leave either dangling — this
 * check exists as defense-in-depth against direct DB tampering or a future
 * migration that weakens those FKs, per the phase-12 framing that drift is a
 * potential tampering signal, not merely a bug signal.
 */
async function findOrphanBinaryNodes(): Promise<OrphanBinaryNode[]> {
  const nodes = await prisma.binaryNode.findMany({
    select: { userId: true, parentId: true },
  });
  const nodeIds = new Set(nodes.map((n) => n.userId));

  const userIds = await prisma.user.findMany({
    where: { id: { in: nodes.map((n) => n.userId) } },
    select: { id: true },
  });
  const realUserIds = new Set(userIds.map((u) => u.id));

  const orphans: OrphanBinaryNode[] = [];
  for (const node of nodes) {
    if (!realUserIds.has(node.userId)) {
      orphans.push({ userId: node.userId, reason: "user_not_found", parentId: node.parentId });
      continue;
    }
    if (node.parentId !== null && !nodeIds.has(node.parentId)) {
      orphans.push({ userId: node.userId, reason: "parent_not_found", parentId: node.parentId });
    }
  }

  return orphans;
}

/**
 * Defense-in-depth re-check of the real uniqueness scope enforced by the
 * `ledger_entries_idempotency_key_user_id_wallet_direction_key` index
 * (idempotency_key, coalesce(user_id, 'SYSTEM_EXTERNAL'), wallet,
 * direction) — see the 20260813120000_ledger_composite_idempotency_key
 * migration. This should always come back empty in practice since the DB
 * constraint already rejects a real collision at write time; this check
 * exists so a bypassed/weakened constraint (a dropped index, manual DB
 * surgery) is still caught by the same reconciliation-style sweep, not
 * silently missed until money visibly disagrees.
 */
async function findDuplicateIdempotencyKeys(): Promise<DuplicateIdempotencyKey[]> {
  const groups = await prisma.ledgerEntry.groupBy({
    by: ["idempotencyKey", "userId", "wallet", "direction"],
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  });

  return groups.map((g) => ({
    idempotencyKey: g.idempotencyKey,
    userId: g.userId,
    wallet: g.wallet,
    direction: g.direction,
    count: g._count.id,
  }));
}

/**
 * Sweeps three invariants that must always hold regardless of how the data
 * was reached: no negative wallet balances, no orphan binary_nodes, no
 * duplicate idempotency keys on the ledger's real composite uniqueness
 * scope. Returns a structured report (mirroring `ReconciliationReport`) by
 * default; pass `throwOnViolation: true` to also throw loudly on any
 * violation, matching `runReconciliation`'s posture for callers (e.g. the
 * nightly job) that want a violation treated as a potential tampering
 * signal rather than silently returned.
 */
export async function runInvariantChecks(
  options: { throwOnViolation?: boolean } = {},
): Promise<InvariantCheckReport> {
  const throwOnViolation = options.throwOnViolation ?? false;

  const [negativeBalances, orphanBinaryNodes, duplicateIdempotencyKeys] = await Promise.all([
    findNegativeBalances(),
    findOrphanBinaryNodes(),
    findDuplicateIdempotencyKeys(),
  ]);

  const report: InvariantCheckReport = {
    clean:
      negativeBalances.length === 0 &&
      orphanBinaryNodes.length === 0 &&
      duplicateIdempotencyKeys.length === 0,
    negativeBalances,
    orphanBinaryNodes,
    duplicateIdempotencyKeys,
  };

  if (!report.clean && throwOnViolation) {
    const lines: string[] = [];
    for (const b of negativeBalances) {
      lines.push(`negative balance: user=${b.userId} wallet=${b.wallet} balance=${b.balance}`);
    }
    for (const o of orphanBinaryNodes) {
      lines.push(`orphan binary_nodes row: user=${o.userId} reason=${o.reason} parentId=${o.parentId}`);
    }
    for (const d of duplicateIdempotencyKeys) {
      lines.push(
        `duplicate idempotency key: key=${d.idempotencyKey} user=${d.userId} wallet=${d.wallet} direction=${d.direction} count=${d.count}`,
      );
    }
    throw new Error(`Invariant checks FAILED — ${lines.length} violation(s):\n${lines.join("\n")}`);
  }

  return report;
}
