/**
 * One-time data repair (reported 2026-09-30, see tasks/lessons.md) — run via
 * `npx tsx scripts/repair-simulated-daily-interest-cmudeva3t.ts`.
 *
 * Three manual "Simulate 30 days of Daily Interest" clicks on 2026-09-29
 * (each one correctly chaining forward from wherever the investment's
 * ledger already was, by design) pushed investment cmudeva3t000zmn01z8gr3ntx
 * 90 days into the future — every DAILY_INTEREST entry from 2026-10-01
 * through 2026-12-28 is fabricated/simulated, not real. Confirmed with the
 * project owner: 2026-10-01 was this investment's very first DAILY_INTEREST
 * entry ever (no real entry existed before the Sep 29 simulation), so the
 * correct repair is to reverse EVERY DAILY_INTEREST entry for this
 * investment, restoring it to zero accrued interest — exactly its state
 * before Sep 29.
 *
 * Uses `reverseLedgerTransaction` (manual-adjustment.ts) — the existing,
 * tested, production reversal path. Never deletes or updates a ledger row
 * (invariant #2); posts a new, equal-and-opposite entry for every row in
 * each original transaction. Idempotent by construction: the reversal key
 * is deterministic (`manual_adjustment:<originalKey>`), so re-running this
 * script after a partial failure skips every transaction already reversed
 * rather than double-reversing it.
 */
import { prisma } from "../src/lib/prisma";
import { reverseLedgerTransaction, AlreadyReversedError } from "../src/lib/manual-adjustment";

const INVESTMENT_ID = "cmudeva3t000zmn01z8gr3ntx";
const REASON =
  "Reversing fabricated Daily Interest entries posted by three repeated " +
  "'Simulate 30 days' clicks on 2026-09-29, which pushed this investment " +
  "90 days into the future (through 2026-12-28) with no real entries " +
  "existing before that date.";

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });

  const entries = await prisma.ledgerEntry.findMany({
    where: { referenceType: "investment", referenceId: INVESTMENT_ID, entryType: "DAILY_INTEREST" },
    select: { idempotencyKey: true },
    distinct: ["idempotencyKey"],
    orderBy: { idempotencyKey: "asc" },
  });

  console.log(`Found ${entries.length} distinct DAILY_INTEREST transactions for ${INVESTMENT_ID}.`);

  let reversed = 0;
  let alreadyDone = 0;

  for (const { idempotencyKey } of entries) {
    try {
      await reverseLedgerTransaction(admin.id, { idempotencyKey, reason: REASON });
      reversed++;
      console.log(`Reversed: ${idempotencyKey}`);
    } catch (err) {
      if (err instanceof AlreadyReversedError) {
        alreadyDone++;
        console.log(`Already reversed, skipping: ${idempotencyKey}`);
        continue;
      }
      throw err;
    }
  }

  console.log(`\nDone. Reversed ${reversed}, already-reversed ${alreadyDone}, total ${entries.length}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
