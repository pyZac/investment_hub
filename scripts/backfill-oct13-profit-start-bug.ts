/**
 * One-time backfill (reported 2026-10-14) — run via
 * `npx tsx scripts/backfill-oct13-profit-start-bug.ts --dry-run` first, then
 * `--execute` once the dry-run output looks correct. Requires exactly one
 * of those two flags — refuses to run with neither, same pattern as
 * scripts/repair-simulated-daily-interest-cmudeva3t.ts.
 *
 * Bug fixed in daily-interest.ts: accrueDailyInterestForInvestment compared
 * `forDate` (always Dubai-midnight-aligned from the real scheduler) against
 * `investment.profitStartsAt` (purchasedAt + 7 days, carrying whatever
 * time-of-day the real purchase happened at) with a plain `<` on the raw
 * instant. Whenever profitStartsAt's time-of-day was later than midnight,
 * this incorrectly skipped the investment's first eligible day
 * ("before_profit_start") even though that day IS the correct day 8 under
 * wallet_interest_audit_rules_log.md's "day 8 onward" rule. Fixed by
 * comparing Dubai BUSINESS DAYS (`startOfDubaiDay`) instead of raw instants
 * — see daily-interest.ts's own comment on the fix and tasks/lessons.md for
 * the traced boundary case.
 *
 * Investment cmuwj5meg0012nt01q6hjc3wf (user cmu6uwmgn001au401eequryxm) was
 * skipped for 2026-10-13 by this bug. The real daily cron already marked
 * periodKey "2026-10-13" COMPLETED for the daily_interest job (every OTHER
 * active investment that day was correctly processed — only this one, and
 * possibly others with the same non-midnight-profitStartsAt shape, got
 * silently skipped) — `runOnePeriod` (daily-interest-job.ts) only skips a
 * periodKey already marked COMPLETED; it never looks at individual
 * investments again once that happens. So the catch-up loop will never
 * revisit 2026-10-13 on its own.
 *
 * This script does NOT hand-compute or post any ledger entry itself — that
 * would duplicate accrueDailyInterestForInvestment's real formula outside
 * the engine, risking drift between the two. Instead it deletes the single
 * job_runs row for (daily_interest, "2026-10-13"), so the next real
 * scheduler tick (or a manual Job Monitor trigger) naturally re-walks that
 * period through `runDailyInterestCatchUp`, which re-evaluates EVERY active
 * investment for that date using the real, now-fixed engine code. This is
 * safe for every investment that was already correctly processed that day:
 * `accrueDailyInterestForInvestment`'s own idempotency key
 * (`daily_interest:{userId}:{investmentId}:{date}`) already exists for
 * them, so `postTransaction` returns `alreadyProcessed: true` and writes
 * nothing — only investments this bug actually skipped get a new entry.
 *
 * `job_runs` rows are real operational history, not literally undeletable
 * like `ledger_entries` (no DB trigger blocks this) — but deleting one is
 * still a real production action, not a cosmetic no-op, which is why this
 * script has the same --dry-run/--execute gate as every other
 * production-touching script in this project, rather than being run ad hoc.
 */
import { prisma } from "../src/lib/prisma";

const JOB_TYPE = "daily_interest";
const PERIOD_KEY = "2026-10-13";
const INVESTMENT_ID = "cmuwj5meg0012nt01q6hjc3wf";

function parseMode(): "dry-run" | "execute" {
  const hasDryRun = process.argv.includes("--dry-run");
  const hasExecute = process.argv.includes("--execute");
  if (hasDryRun === hasExecute) {
    console.error('Pass exactly one of "--dry-run" or "--execute".');
    process.exit(1);
  }
  return hasDryRun ? "dry-run" : "execute";
}

async function main() {
  const mode = parseMode();
  console.log(`Mode: ${mode}${mode === "dry-run" ? " (read-only, nothing will be written)" : ""}\n`);

  const jobRun = await prisma.jobRun.findUnique({
    where: { jobType_periodKey: { jobType: JOB_TYPE, periodKey: PERIOD_KEY } },
  });

  if (!jobRun) {
    console.log(`No job_runs row found for (${JOB_TYPE}, ${PERIOD_KEY}) — nothing to do.`);
    return;
  }

  console.log(`Found job_runs row: ${JSON.stringify(jobRun, null, 2)}`);
  if (jobRun.status !== "COMPLETED") {
    console.log(
      `\nStatus is ${jobRun.status}, not COMPLETED — the real catch-up loop will already retry this periodKey on` +
        ` its own next run. Deleting it is unnecessary; refusing to avoid an unneeded write.`,
    );
    return;
  }

  const investment = await prisma.investment.findUnique({ where: { id: INVESTMENT_ID } });
  if (!investment) {
    console.log(`\nWARNING: investment ${INVESTMENT_ID} not found in this database.`);
  } else {
    const existingEntry = await prisma.ledgerEntry.findFirst({
      where: {
        idempotencyKey: `daily_interest:${investment.userId}:${INVESTMENT_ID}:${PERIOD_KEY}`,
        wallet: "A",
        direction: "CREDIT",
      },
    });
    console.log(
      `\nInvestment ${INVESTMENT_ID}: profitStartsAt=${investment.profitStartsAt.toISOString()}, ` +
        `status=${investment.status}. Existing DAILY_INTEREST entry for ${PERIOD_KEY}: ${existingEntry ? "YES (already has one — unexpected)" : "none (confirms the bug skipped it)"}.`,
    );
  }

  if (mode === "dry-run") {
    console.log(
      `\nWould delete job_runs row (${JOB_TYPE}, ${PERIOD_KEY}). The next catch-up run will then ` +
        `re-process every active investment for that date through the real, fixed engine code.`,
    );
    return;
  }

  await prisma.jobRun.delete({ where: { id: jobRun.id } });
  console.log(`\nDeleted job_runs row (${JOB_TYPE}, ${PERIOD_KEY}). ` +
    `Trigger the daily_interest job (worker cron tick, or Job Monitor's manual trigger) to replay it.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
