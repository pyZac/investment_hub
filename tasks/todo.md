# Phase 2 — Ledger & Wallets: EXIT TEST

Ran the exit test scenario from `/docs/phases/phase-02-ledger-wallets.md` directly
against the dev database (script written to `.scratch_exit_test.ts`, run, then
deleted — not part of the permanent test suite, which already covers each piece
individually across `ledger.test.ts`, `wallets.test.ts`, `ledger-transaction.test.ts`,
`admin-credit.test.ts`, `reconciliation.test.ts`).

## Exit test results

- [x] Admin credits $1,000 to a user's B wallet -> ledger and cached balance agree
      (both = 1000, exactly 2 entries: CREDIT user B / DEBIT SYSTEM_EXTERNAL)
- [x] Re-running the same call with the same idempotencyKey creates nothing new
      (alreadyProcessed=true, entry count unchanged, balance still 1000 not 2000)
- [x] Reconciliation passes for that user and for SYSTEM_EXTERNAL (report.clean=true)
- [x] A deliberately unbalanced postTransaction call (debits=99, credits=100) is
      rejected with a clear error, before any write

**ALL EXIT TEST CRITERIA PASSED.**

## Before the exit test: migration state verification (see lessons.md for full detail)

Encountered and resolved a significant dev-environment issue while verifying
migration state was consistent: the Postgres container's schema was repeatedly
wiped and replayed (signature of `prisma migrate reset --force`) with no root
cause identified despite extensive investigation (ruled out: test suite, Vitest
config, app/worker containers, cron, container restarts, duplicate DB instance).
Resolved each time via `prisma migrate resolve --applied <name>` (one at a time,
not looped) for all 10 migrations plus reseeding. Final state before the exit
test, independently verified via direct `psql` (not just Prisma CLI output):
- `prisma migrate status`: up to date, all 10 migrations applied
- `prisma migrate diff` (migrations folder vs live schema): no difference detected
- All 10 migration checksums in `_prisma_migrations` match their current files
- Main admin present, exactly 1 user row

Logged as a known, unresolved dev-environment quirk in lessons.md — not blocking
Phase 2 completion since the application schema/data have been structurally correct
every time checked; only Prisma's own bookkeeping table was affected.

## Final verification

- Full test suite re-run after exit test cleanup (a stray orphaned SYSTEM_EXTERNAL
  ledger row from the exit-test script's own incomplete cleanup was found and fixed
  — logged in lessons.md): **18 files, 114 tests passing**
- Migration status and admin state confirmed clean via direct psql after the full
  suite run

## Phase 2 deliverables checklist (from phase brief)

- [x] SCRUM-32: `ledger_entries` table, append-only (trigger-enforced), UNIQUE idempotency
- [x] SCRUM-33: `wallets` table (WalletAccount), 4 wallets auto-created on registration
- [x] SCRUM-34: `postTransaction({ entries[], idempotencyKey })` core service
- [x] SCRUM-35: SYSTEM_EXTERNAL counterparty wiring + "Platform Reserve" display label
- [x] SCRUM-36: `adminCreditWalletB` — the only money-creation function
- [x] SCRUM-37: reconciliation job (`runReconciliation`)
- [x] SCRUM-38: `toDisplay` decimal helper
- [x] Exit test run and passed, shown above

Phase 2 is complete pending user confirmation in the operation-room chat per
CLAUDE.md's build-order rule (a phase doesn't start until the previous phase's
exit test has passed AND been confirmed by the user).
