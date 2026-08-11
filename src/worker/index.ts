/**
 * Worker process entrypoint. No scheduled jobs yet — node-cron jobs
 * (daily interest, Friday payouts, weekly binary, monthly rank) land in
 * Phase 4. This keeps the `worker` service alive so it's part of the
 * deployment topology from day one.
 */
console.log("[worker] started, no jobs scheduled yet");

setInterval(() => {}, 1 << 30);
