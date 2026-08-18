import { prisma } from "./prisma";

/**
 * Deletes every ledger_entries row belonging to test-created users, INCLUDING
 * the paired SYSTEM_EXTERNAL row (userId: null) from the same
 * postTransaction call — not just the rows whose userId matches one of the
 * given ids.
 *
 * Why this exists: `ledgerEntry.deleteMany({ where: { userId: { in:
 * createdUserIds } } })` looks correct but silently leaves every
 * SYSTEM_EXTERNAL-side row behind, because that row's userId is null, never
 * one of the test's own user ids. This has caused real global-solvency drift
 * in the shared dev DB three separate times (see tasks/lessons.md). Some
 * production functions also generate their idempotencyKey internally
 * (`transferAtoB`, etc.), so a test can't always capture the key in advance
 * either — the only value a test reliably has up front is the user ids it
 * created. This helper derives the correct cleanup scope from that: find
 * every ledger entry for those users, collect the distinct idempotencyKeys
 * those entries belong to, then delete every row sharing any of those keys
 * (any userId, including null) — which structurally includes every
 * SYSTEM_EXTERNAL sibling, with no manual array-pushing required at any
 * call site.
 *
 * Use this instead of writing `ledgerEntry.deleteMany({ where: { userId: ...
 * } })` by hand in any test or scratch script's cleanup — that pattern is
 * the specific mistake this helper exists to make structurally impossible
 * to repeat.
 */
export async function cleanupLedgerEntriesForUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  const ownEntries = await prisma.ledgerEntry.findMany({
    where: { userId: { in: userIds } },
    select: { idempotencyKey: true },
  });
  const idempotencyKeys = [...new Set(ownEntries.map((e) => e.idempotencyKey))];

  if (idempotencyKeys.length === 0) {
    return;
  }

  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" DISABLE TRIGGER ledger_entries_no_delete`);
  try {
    await prisma.ledgerEntry.deleteMany({
      where: { idempotencyKey: { in: idempotencyKeys } },
    });
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" ENABLE TRIGGER ledger_entries_no_delete`);
  }
}
