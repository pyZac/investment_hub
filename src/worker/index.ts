// Must load before any other import — config.ts parses process.env at import
// time, and plain tsx (unlike Vitest's Vite-based runner) does not auto-load
// .env on its own.
import "dotenv/config";
import cron from "node-cron";
import { config } from "../lib/config";
import { runDailyInterestCatchUp, DAILY_INTEREST_JOB_TYPE } from "../lib/daily-interest-job";
import { runBinaryCycleCatchUp, BINARY_CYCLE_JOB_TYPE } from "../lib/binary-cycle-job";
import { runRankEvaluationCatchUp, RANK_EVALUATION_JOB_TYPE } from "../lib/rank-evaluation-job";
import { runRankPayoutCatchUp, RANK_PAYOUT_JOB_TYPE } from "../lib/rank-payout-job";
import { runReconciliationCatchUp, RECONCILIATION_JOB_TYPE } from "../lib/reconciliation-job";

/**
 * Structured logging (SCRUM-128). Each call prints exactly one JSON object
 * per line to stdout/stderr — Railway's log viewer can filter by `job` or
 * `level` this way, which free-text `[worker] ... job triggered` strings
 * couldn't support. No new logging library, per this ticket's own
 * instruction — plain JSON.stringify at each call site is sufficient for
 * this project's scope.
 */
type JobLogLevel = "info" | "error";

function logJob(level: JobLogLevel, job: string, message: string, extra?: Record<string, unknown>): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    job,
    message,
    ...extra,
  });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

/**
 * Worker process entrypoint. This file is the one place `new Date()` is
 * appropriate in the daily-interest code path (invariant #4) — it is the
 * real scheduler entry point, not engine logic; `runDailyInterestCatchUp`
 * itself takes `today` as a parameter and stays pure/testable.
 *
 * Daily at 00:05 Asia/Dubai. Catch-up logic inside runDailyInterestCatchUp
 * means a missed trigger (worker down, deploy, crash) is not lost — the next
 * successful run processes every period back to the last COMPLETED one.
 */
cron.schedule(
  "5 0 * * *",
  async () => {
    logJob("info", DAILY_INTEREST_JOB_TYPE, "job triggered");
    try {
      await runDailyInterestCatchUp(new Date());
      logJob("info", DAILY_INTEREST_JOB_TYPE, "job completed");
    } catch (error) {
      logJob("error", DAILY_INTEREST_JOB_TYPE, "job failed", { error: String(error) });
    }
  },
  { timezone: config.TIMEZONE },
);

/**
 * Weekly binary cycle close (Phase 8, SCRUM-80). Saturday 00:00 Asia/Dubai
 * — the exact start of the new cycle, which is also the moment the prior
 * week (Saturday 00:00 -> Friday 23:59) becomes closeable.
 * runBinaryCycleCatchUp itself takes `today` as a parameter and stays
 * pure/testable; catch-up logic inside it means a missed trigger doesn't
 * skip a week, it processes it on the next successful run.
 */
cron.schedule(
  "0 0 * * 6",
  async () => {
    logJob("info", BINARY_CYCLE_JOB_TYPE, "job triggered");
    try {
      await runBinaryCycleCatchUp(new Date());
      logJob("info", BINARY_CYCLE_JOB_TYPE, "job completed");
    } catch (error) {
      logJob("error", BINARY_CYCLE_JOB_TYPE, "job failed", { error: String(error) });
    }
  },
  { timezone: config.TIMEZONE },
);

/**
 * Monthly rank evaluation (Phase 9, SCRUM-88). 00:10 Asia/Dubai on the 1st
 * of each month — just after midnight, once the just-ended calendar month's
 * MRV totals are final (a month isn't closeable/evaluable until it has
 * fully ended). Offset 5 minutes after the daily interest job's own 00:05
 * trigger to reduce contention on the same midnight boundary.
 * runRankEvaluationCatchUp itself takes `today` as a parameter and stays
 * pure/testable; catch-up logic inside it means a missed trigger doesn't
 * skip a month, it processes it on the next successful run.
 */
cron.schedule(
  "10 0 1 * *",
  async () => {
    logJob("info", RANK_EVALUATION_JOB_TYPE, "job triggered");
    try {
      await runRankEvaluationCatchUp(new Date());
      logJob("info", RANK_EVALUATION_JOB_TYPE, "job completed");
    } catch (error) {
      logJob("error", RANK_EVALUATION_JOB_TYPE, "job failed", { error: String(error) });
    }
  },
  { timezone: config.TIMEZONE },
);

/**
 * Weekly rank reward payout sweep (Phase 9, SCRUM-88). Saturday 00:00
 * Asia/Dubai — the SAME cadence as the binary cycle job, since both settle
 * on the Saturday-to-Friday weekly processing cycle boundary (a rank
 * reward is "credited on the next Friday cycle," per mlm_rules_log).
 * runRankPayoutCatchUp itself takes `today` as a parameter and stays
 * pure/testable; catch-up logic inside it means a missed trigger doesn't
 * skip a week, it processes it on the next successful run.
 */
cron.schedule(
  "0 0 * * 6",
  async () => {
    logJob("info", RANK_PAYOUT_JOB_TYPE, "job triggered");
    try {
      await runRankPayoutCatchUp(new Date());
      logJob("info", RANK_PAYOUT_JOB_TYPE, "job completed");
    } catch (error) {
      logJob("error", RANK_PAYOUT_JOB_TYPE, "job failed", { error: String(error) });
    }
  },
  { timezone: config.TIMEZONE },
);

/**
 * Nightly reconciliation + invariant sweep (Phase 12, SCRUM-117). 00:20
 * Asia/Dubai — after the daily interest job's own 00:05 trigger, so the
 * check reflects the day's postings rather than racing them. Offset from
 * the other midnight-boundary jobs (00:05 daily interest, 00:10 rank
 * evaluation) to reduce contention.
 * runReconciliationCatchUp itself takes `today` as a parameter and stays
 * pure/testable; it has no real "catch-up" backlog (a point-in-time
 * snapshot check, not per-period business data) but follows the same
 * job_runs contract as every other scheduled job here.
 */
cron.schedule(
  "20 0 * * *",
  async () => {
    logJob("info", RECONCILIATION_JOB_TYPE, "job triggered");
    try {
      await runReconciliationCatchUp(new Date());
      logJob("info", RECONCILIATION_JOB_TYPE, "job completed");
    } catch (error) {
      logJob("error", RECONCILIATION_JOB_TYPE, "job failed", { error: String(error) });
    }
  },
  { timezone: config.TIMEZONE },
);

logJob("info", "worker", "started");
logJob("info", DAILY_INTEREST_JOB_TYPE, `scheduled for 00:05 ${config.TIMEZONE}`);
logJob("info", BINARY_CYCLE_JOB_TYPE, `scheduled for Saturday 00:00 ${config.TIMEZONE}`);
logJob("info", RANK_EVALUATION_JOB_TYPE, `scheduled for 00:10 on the 1st of each month ${config.TIMEZONE}`);
logJob("info", RANK_PAYOUT_JOB_TYPE, `scheduled for Saturday 00:00 ${config.TIMEZONE}`);
logJob("info", RECONCILIATION_JOB_TYPE, `scheduled for 00:20 ${config.TIMEZONE}`);

setInterval(() => {}, 1 << 30);
