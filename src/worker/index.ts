// Must load before any other import — config.ts parses process.env at import
// time, and plain tsx (unlike Vitest's Vite-based runner) does not auto-load
// .env on its own.
import "dotenv/config";
import cron from "node-cron";
import { config } from "../lib/config";
import { runDailyInterestCatchUp } from "../lib/daily-interest-job";

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
    console.log("[worker] daily interest job triggered");
    try {
      await runDailyInterestCatchUp(new Date());
      console.log("[worker] daily interest job completed");
    } catch (error) {
      console.error("[worker] daily interest job failed", error);
    }
  },
  { timezone: config.TIMEZONE },
);

console.log(`[worker] started, daily interest job scheduled for 00:05 ${config.TIMEZONE}`);

setInterval(() => {}, 1 << 30);
