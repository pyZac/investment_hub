# Phase 13 — Deployment

**Goal:** the system runs on a real server, supervised, backed up, and observable.

**Prerequisites:** Phase 12 complete, its exit test passed.

**Read before starting:** `/docs/build_plan.md` Phase 13 section and the Transport &
Headers / Secrets subsections of Part 7.

## Deliverables

1. Docker Compose production profile.
2. Nginx or Caddy reverse proxy with TLS, HTTP→HTTPS redirect, HSTS enabled.
3. Postgres backups: `pg_dump` on cron, with an off-box copy.
4. Worker process supervised and auto-restarting — the daily interest, Friday
   payout, weekly binary, and monthly rank jobs all depend on it being alive. The
   catch-up logic from Phase 4 means a restart is safe, but the worker must actually
   come back.
5. Structured logging and error tracking.
6. Deployment runbook: how to deploy, how to roll back, how to restore from backup,
   how to re-trigger a missed job safely.

## Constraints specific to this phase

- Distinct secrets per environment — database credentials and session signing keys
  are never reused across dev/staging/production.
- The app's database user has least-privilege grants (no DROP/ALTER in production),
  separate from the migration-runner credential. This also reinforces the
  append-only ledger guarantee.
- `.env` is never committed; `.env.example` documents required variables without
  real values.

## Exit test

A clean deploy to the target server comes up healthy: app reachable over HTTPS with
valid TLS, worker running and processing its first scheduled job, database reachable
with least-privilege credentials. A backup is taken and a restore is rehearsed to
prove it works. Killing the worker process results in automatic restart, and the
catch-up logic credits any missed interest day correctly.

Run it and show the output.
