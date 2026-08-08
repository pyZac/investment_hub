# Phase 2 — Ledger & Wallets ⭐ MOST IMPORTANT PHASE

**Goal:** the money primitive. Every later phase calls into this. Get it right here
and the rest is mechanical; get it wrong and every downstream number is suspect.

**Prerequisites:** Phase 1 complete, its exit test passed.

**Read before starting:** `/docs/build_plan.md` Part 2 Decision 1 (double-entry
ledger) and Decision 2 (idempotency and catch-up) — read these in full, they are
short and this phase is their implementation. Also Part 3 schema for
`ledger_entries`, `wallets`. `/docs/wallet_interest_audit_rules_log.md` Section 4
(Accounting & Audit, including Precision).

## Deliverables

1. `ledger_entries` table exactly per Decision 1: `id, user_id (nullable for
   SYSTEM_EXTERNAL), wallet, direction, amount NUMERIC(24,8), entry_type,
   reference_type, reference_id, comment, idempotency_key UNIQUE, metadata JSONB,
   created_at`. Append-only — revoke UPDATE/DELETE at the DB role level if possible.
2. Four wallets auto-created per user on registration: A, B, C, SAVING, with
   `UNIQUE(user_id, type)`.
3. **Core service `postTransaction({ entries[], idempotencyKey })`** — validates
   that debits equal credits, writes all entries and updates cached balances,
   all inside one DB transaction. Every money movement in this entire system goes
   through this function. There are no exceptions and no single-sided writes.
4. `SYSTEM_EXTERNAL` counterparty account — a special non-user ledger account
   representing "outside the simulation." Admin credit issuance is CREDIT user's B
   / DEBIT `SYSTEM_EXTERNAL`. A Wallet B exit burn is DEBIT user's B / CREDIT
   `SYSTEM_EXTERNAL`. Displayed to admins as **"Platform Reserve"**, never the raw
   internal name.
5. `adminCreditWalletB(userId, amount, reason)` — the only money-creation point in
   the system. `reason` is mandatory: it is stored both as the ledger entry's
   `comment` and in `admin_actions`. The action cannot submit without it.
6. Reconciliation job asserting `SUM(ledger) == wallets.balance` for every user
   including `SYSTEM_EXTERNAL`, alarming on mismatch.
7. Decimal helpers: `toDisplay(d)` → 2dp round-half-up string. Never `Number()`.

## Constraints specific to this phase

- **Invariant #1 is absolute here**: no JS `number` touches a money value at any
  point. `Prisma.Decimal` end to end; string conversion only at final render.
- **Invariant #2**: no UPDATE, no DELETE on `ledger_entries`, ever. Corrections
  are new reversing entries. Build this so the wrong thing is hard, not just
  discouraged.
- `wallets.balance` is a **cached** column for read performance, not the source of
  truth. The ledger is the truth; the cache is updated in the same transaction.
- Idempotency key format is deterministic (see Decision 2 for the patterns used by
  later phases). The `UNIQUE` constraint is what makes double-payment impossible at
  the database level — not application-level checking.
- Every entry's `comment` field must be populated: system-generated entries
  auto-fill it, admin actions require typed input.

## Exit test

Admin credits $1,000 to a user's B wallet. The ledger and the cached balance agree.
Re-running the same call with the same idempotency key creates nothing new (no
duplicate entry, no double balance). Reconciliation passes for that user and for
`SYSTEM_EXTERNAL`. A deliberately unbalanced `postTransaction` call (debits ≠
credits) is rejected.

Run it and show the output. This is the phase to be paranoid about.
