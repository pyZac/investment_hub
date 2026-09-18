-- Least-privilege Postgres roles for this project's Railway deployment
-- (Phase 13 / SCRUM-126).
--
-- Plain SQL, no string interpolation, no ORM — this is exactly the kind of
-- one-time DDL/role-management operation invariant #10 ("no
-- $queryRawUnsafe/$executeRawUnsafe") doesn't apply to (it's not a Prisma
-- query at all), but it's still written as static SQL with no dynamic
-- value substitution, for the same reason: nothing here should ever accept
-- untrusted input.
--
-- Run in TWO PARTS, in this exact order, against a fresh Railway Postgres
-- instance. See docs/runbook.md's "Least-privilege database roles" section
-- for exactly when/how to run each part (via Railway's Postgres "Connect"
-- query console, or `psql` against the plugin's admin connection string).
--
--   PART 1 (below) — run BEFORE the first `prisma migrate deploy`.
--   Then run `prisma migrate deploy` as `migrator` (creates every table).
--   PART 2 (bottom of this file) — run AFTER that first migration.
--
-- This ordering is required, not just convenient — verified directly while
-- writing this script: Postgres DDL rights (ALTER/DROP on a specific
-- table) are governed by table OWNERSHIP, not schema-level grants. A table
-- created by some other role (e.g. Railway's own Postgres plugin default
-- role) cannot be ALTERed/DROPped by `migrator` just because `migrator` has
-- `GRANT ALL ... ON SCHEMA public` — confirmed by reproducing exactly this
-- failure in a scratch test. Running Part 1 first means `migrator` itself
-- creates every table via the first `prisma migrate deploy`, so it owns
-- everything from the start. Likewise, Part 2's `REVOKE ... ON
-- ledger_entries` fails with "relation does not exist" if run before that
-- table exists — also reproduced directly — so it cannot be merged into
-- Part 1.
--
-- Replace both placeholder passwords with real, freshly-generated secrets
-- before running — never reuse these across environments (dev/staging/
-- production), per CLAUDE.md's non-negotiable invariants and
-- build_plan.md Part 7's "Secrets & Configuration" section.

-- ============================================================
-- PART 1 — run before the first `prisma migrate deploy`.
-- ============================================================

-- 1a. migrator: full DDL rights, used only to run `prisma migrate deploy`.
--     Never used by the running app/worker services.
CREATE ROLE migrator LOGIN PASSWORD 'REPLACE_WITH_REAL_MIGRATOR_SECRET';
GRANT ALL PRIVILEGES ON DATABASE investment_hub TO migrator;
GRANT ALL PRIVILEGES ON SCHEMA public TO migrator;

-- 1b. app: least privilege, used by the running app/worker services for
--     all normal request-time and job-time queries.
--       - SELECT/INSERT/UPDATE/DELETE on every table (the ledger_entries
--         carve-out happens in Part 2, once that table exists).
--       - No CREATE/DROP/ALTER/TRUNCATE anywhere — schema changes only
--         ever happen via `migrator` running a real migration, never at
--         runtime.
CREATE ROLE app LOGIN PASSWORD 'REPLACE_WITH_A_DIFFERENT_REAL_APP_SECRET';
GRANT CONNECT ON DATABASE investment_hub TO app;
GRANT USAGE ON SCHEMA public TO app;

-- Ensures tables/sequences created by EVERY `prisma migrate deploy` run
-- (as migrator) — including the very first one, which runs after this
-- script — are automatically visible to `app`, without re-running grants
-- by hand after every migration.
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app;

-- ============================================================
-- >>> Run `prisma migrate deploy` here, connected as `migrator`. <<<
-- This creates every table (users, ledger_entries, wallets, ...) with
-- `migrator` as owner, and — because of the ALTER DEFAULT PRIVILEGES
-- above — `app` automatically gets SELECT/INSERT/UPDATE/DELETE on all of
-- them the moment they're created. Do not run Part 2 until this has
-- completed successfully.
-- ============================================================

-- ============================================================
-- PART 2 — run once, immediately after the first `prisma migrate deploy`
-- has completed (ledger_entries must already exist).
--
-- Narrows ledger_entries specifically: `app` keeps SELECT/INSERT (granted
-- automatically by Part 1's default-privileges rule) but loses
-- UPDATE/DELETE. This is invariant #2 ("no ledger UPDATE or DELETE —
-- corrections are new reversing entries") enforced at the database level,
-- not just in application code. Every OTHER table in this schema (wallets
-- cache, sessions, pending_auths, job_runs, etc.) keeps full CRUD for
-- `app` — real production code paths (session logout, pending-auth
-- consumption, wallet balance cache updates) update/delete rows on those
-- tables and would break if denied.
-- ============================================================

REVOKE UPDATE, DELETE ON ledger_entries FROM app;

-- NOTE: this REVOKE applies only to the ledger_entries table as it exists
-- right now. It does NOT need to be re-run after future migrations that
-- merely ALTER ledger_entries (add a column, etc.) — REVOKE targets stay
-- attached to the table's identity, not its column set. It WOULD need to
-- be re-run if a future migration ever DROPs and recreates ledger_entries
-- from scratch (it shouldn't, per invariant #2, but if schema evolution
-- ever does replace it, re-run this one line as part of that migration's
-- own rollout checklist — Part 1's default-privileges rule would otherwise
-- silently re-grant UPDATE/DELETE on the new table).

-- ============================================================
-- Verification (run these manually after Part 2, not part of setup itself
-- — confirm the grants actually landed as intended before pointing any
-- real service at these roles):
--
--   \du app migrator
--   SELECT grantee, table_name, privilege_type
--     FROM information_schema.role_table_grants
--     WHERE grantee = 'app' AND table_name = 'ledger_entries'
--     ORDER BY privilege_type;
--   -- Expect exactly: INSERT, SELECT. No UPDATE, no DELETE.
--
--   SELECT grantee, table_name, privilege_type
--     FROM information_schema.role_table_grants
--     WHERE grantee = 'app' AND table_name = 'sessions'
--     ORDER BY privilege_type;
--   -- Expect all four: DELETE, INSERT, SELECT, UPDATE.
-- ============================================================
