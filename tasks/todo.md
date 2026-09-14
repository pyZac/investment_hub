# Phase 12 — Audit, Reconciliation & Security Hardening — Session Todo

## Pre-flight findings (what already exists vs. what's missing)

Already built (earlier phases):
- `src/lib/reconciliation.ts` — core `runReconciliation()` (wallet-vs-ledger + SYSTEM_EXTERNAL
  global solvency), already throws loudly on drift. Needs: a schedulable nightly job wrapper,
  not new detection logic.
- `SecurityEvent` model + `SecurityEventType` enum (LOGIN_FAILED, ACCOUNT_LOCKED,
  PASSWORD_RESET_FAILED, SECURITY_QUESTION_FAILED, TOTP_ENROLLED, TOTP_REMOVED, TOTP_FAILED),
  already written to from `rate-limit.ts` and `totp-enrollment.ts` (Phase 1). Missing:
  permission grant/revoke and admin account creation events, and an admin-facing screen to
  view them.
- `AdminAction` model/log + admin panel screen pattern (12 screens under `src/app/[locale]/admin/*`).
- `job-monitor.ts` + `job_runs` pattern for catch-up-style scheduled jobs, `src/worker/index.ts`
  cron registrations — the established pattern to extend for a reconciliation job.
- No `$queryRawUnsafe`/`$executeRawUnsafe` in the codebase already (verified by grep) — only
  one `$queryRaw` (health check), correctly tagged-template. Deliverable #7 is mostly "add a
  permanent CI/lint check," not a fix.

Missing entirely:
- No nightly reconciliation *job* (cron + job_runs tracking + alarm-visible-to-admin) — only
  the underlying function.
- No invariant checks for: negative balances, orphan tree nodes, duplicate idempotency keys.
- No per-user statement export (CSV/PDF).
- No admin screen for security events.
- No `AdminPermission` value for viewing security events (needs one, or reuse an existing
  permission — decide during implementation, default to a new `SECURITY_VIEW` permission
  mirroring `SOLVENCY_VIEW`'s pattern).
- No security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy).
- No `.github/` directory at all — no CI workflow, no Dependabot/Renovate config.
- No documented Postgres backup strategy.

## Plan

1. **Invariant checks module** (`src/lib/invariant-checks.ts`)
   - No negative wallet balances (any wallet, any type).
   - No orphan `binary_nodes` (parent_id pointing nowhere, or a node with no matching user).
   - No duplicate idempotency keys (defense-in-depth check against the DB UNIQUE constraint —
     should always come back empty, but the deliverable explicitly calls for this as a check).
   - Returns a structured report like `ReconciliationReport`; throws loudly on any violation
     (same posture as `runReconciliation`).
   - Tests: seed a deliberate violation of each kind directly (bypassing normal engine
     functions, since normal code paths can't produce these), confirm the check catches it,
     clean up per the `cleanupLedgerEntriesForUsers` / idempotencyKey-safe patterns already
     established in this project.

2. **Nightly reconciliation job** (`src/lib/reconciliation-job.ts` + `job_runs` integration)
   - New `job_runs` jobType (e.g. `reconciliation`), scheduled nightly in `src/worker/index.ts`
     (after daily interest, since it should reflect the day's postings).
   - Runs `runReconciliation()` + the new invariant checks; on failure, records a FAILED
     `job_runs` row with the error detail (mirrors existing job pattern) so it's visible on
     the existing job-monitor admin screen — no new alarm channel needed, this project has no
     external paging system.
   - Manually triggerable via the existing `job-monitor.ts` `JOB_TYPES` array (extends, doesn't
     replace, the existing admin re-trigger UI).
   - Test: seed clean data (passes), then deliberately corrupt one cached balance directly via
     `prisma.walletAccount.update` (simulating tampering, per the phase's own framing) and
     confirm the job run is recorded FAILED with the drift detail — this doubles as part of the
     exit test itself.

3. **Per-user statement export** (CSV first; PDF if time allows — confirm CSV-only is acceptable
   before building a PDF pipeline, since no PDF library is in the project yet)
   - Reuses ledger read patterns already in `src/lib/ledger.ts`/existing ledger admin screen.
   - New server action + route, IDOR-checked (only self or a permissioned admin), 2dp display
     values per invariant #1, Western Arabic numerals in Arabic locale per CLAUDE.md.
   - Test: generate a statement for a seeded user with known ledger rows, assert CSV content
     and rounding.

4. **Security event admin screen** (`/admin/security-events`)
   - Per D1: no schema/enum changes. Reads `security_events` (failed logins, lockouts, TOTP
     enrollment/removal/failures) and `admin_actions` (permission grant/revoke, admin account
     creation, and everything else already logged there), merges into one chronological,
     filterable feed.
   - New `AdminPermission` value (`SECURITY_VIEW`, mirroring `SOLVENCY_VIEW`'s pattern) gates
     the screen; main admin bypasses as usual.
   - Same visual/bilingual standards as the rest of the admin panel (via the project's
     frontend-design and bilingual-rtl skills).

5. **Security headers**
   - Add to `next.config.ts` (or middleware) — CSP, `X-Frame-Options: DENY`,
     `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
   - CSP needs to actually allow the app's real script/style sources (Next.js dev mode's
     inline scripts, etc.) — will test in-browser, not just declare a maximally strict policy
     that silently breaks the app.
   - Test: `curl -I` against a running route, assert headers present. Exit test's own
     requirement ("present on every response") means checking more than one route.

6. **Dependency audit / CI**
   - Add `.github/workflows/ci.yml`: install, `npm audit` (won't fail the build on existing
     low-severity noise unless the project wants strict — will check current `npm audit`
     output first), lint, typecheck, test.
   - Add `.github/dependabot.yml` for npm + docker ecosystem update PRs.
   - Confirm lockfile (`package-lock.json`) is committed (expected already, will verify).

7. **Unsafe raw query grep check**
   - CI step (grep for `queryRawUnsafe`/`executeRawUnsafe` across `src/`+`prisma/`, fail the
     build on any match) added to the same GitHub Actions workflow as #6.

8. **Postgres backup strategy (doc only, per D4)**
   - `docs/backup-strategy.md`: `pg_dump` approach, retention policy, restore steps/runbook.
     No cron/off-box automation stood up this phase — that's explicitly Phase 13's job.

## Decisions (confirmed with Zac before coding)

- D1: `admin_actions` already logs `SUBADMIN_CREATED`/`SUBADMIN_PERMISSIONS_UPDATED` etc. —
  no `SecurityEventType` changes. Build one admin screen that reads and merges
  `security_events` + `admin_actions` into a single chronological security feed.
- D2: Statement export is CSV only this phase — no new PDF dependency.
- D3: CI is GitHub Actions — add `.github/workflows/ci.yml` + `.github/dependabot.yml`.
- D4: Backup strategy is documentation/runbook only in Phase 12 (`docs/backup-strategy.md`);
  real `pg_dump` cron/off-box automation is Phase 13's job per build_plan.md's own split.

## Exit test (from phase brief, to run and show output at the end)

- Reconciliation runs clean across a seeded dataset with months of simulated activity.
- A deliberately introduced drift (manually adjusted cached balance) is caught and alarmed.
- Security headers present on every response.
- The unsafe-raw-query grep returns nothing.
- A failed-login burst appears in the security event log.
- A per-user statement exports correctly with 2dp display values.
