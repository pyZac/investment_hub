# Phase 12 — Audit, Reconciliation & Security Hardening

**Goal:** integrity checks and the security controls that only become checkable once
the full system exists.

**Prerequisites:** Phases 0–11 complete.

**Read before starting:** `/docs/build_plan.md` Part 7 (Security Architecture) in
full, and `/docs/wallet_interest_audit_rules_log.md` Section 4.

## Deliverables

1. **Nightly reconciliation**: ledger sum vs cached balances for every user including
   `SYSTEM_EXTERNAL`; alarm loudly on drift. Treat drift as a potential tampering
   signal, not merely a bug signal.
2. **Invariant checks**: no negative balances, no orphan tree nodes, no duplicate
   idempotency keys.
3. Per-user statement export (CSV/PDF).
4. **Security event logging**: failed logins, account lockouts, permission
   grant/revoke, admin account creation, 2FA enrollment/removal — logged with the
   same clarity as financial events, in the style of `admin_actions`. The main admin
   should be able to see "who tried to log into whose account and failed" as easily
   as "who issued credit to whom."
5. **Security headers** via Next.js middleware/config: `Content-Security-Policy`,
   `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: strict-origin-when-cross-origin`.
6. **Dependency audit**: `npm audit` in CI, lockfile committed and enforced,
   Dependabot or Renovate enabled.
7. Grep/lint check confirming `$queryRawUnsafe` / `$executeRawUnsafe` appear nowhere
   in the codebase (invariant #10).
8. Postgres backup strategy.

## Note on scope

Auth-layer security — password hashing, rate limiting, 2FA, session cookie flags —
was built in **Phase 1**, not here. This phase covers what only becomes verifiable
across the whole system. Do not rebuild Phase 1's controls; verify them.

## Exit test

Reconciliation runs clean across a seeded dataset with months of simulated activity.
A deliberately introduced drift (manually adjusted cached balance) is caught and
alarmed. Security headers present on every response. The unsafe-raw-query grep
returns nothing. A failed-login burst appears in the security event log. A per-user
statement exports correctly with 2dp display values.

Run it and show the output.
