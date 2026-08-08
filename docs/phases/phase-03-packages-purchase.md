# Phase 3 — Packages & Purchase

**Goal:** a user turns Wallet B credit into an active investment; admin can manage package tiers.

**Prerequisites:** Phase 2 complete, its exit test passed.

**Read before starting:** `/docs/wallet_interest_audit_rules_log.md` Section 1
(Investment Packages, including the 7 tiers). `/docs/build_plan.md` Part 2
Decision 4 (the "Packages" paragraph specifically) and the `packages` /
`investments` schema in Part 3.

## Deliverables

1. Seed the 7 fixed package tiers as **data, not hardcoded constants**:
   Starter $100, Bronze $500, Silver $1,000, Gold $5,000, Platinum $10,000,
   Diamond $50,000, Elite $100,000. Names are placeholders and renameable; amounts
   are fixed as given.
2. `packages` table: `id, name, amount, is_active, created_at, deactivated_at`.
   Packages carry **name and amount only** — they do NOT carry an interest rate.
3. **Admin package CRUD** — create, edit (name, amount), deactivate. Deactivating
   hides a package from new purchases and never touches investments already made
   under it. Gated by the `PACKAGE_MANAGEMENT` permission.
4. `investments` table: `id, user_id, package_id, amount, purchased_at,
   profit_starts_at (= purchased_at + 7 days), capital_unlocks_at (= purchased_at
   + 6 months), capital_released_at (nullable), status (ACTIVE | CAPITAL_RELEASED)`.
5. Purchase flow: validate Wallet B balance >= package amount, then post through
   `postTransaction`: DEBIT B / CREDIT A, and create the investment row with its
   dates computed.
6. Package list UI + purchase confirmation.
7. "My investments" view showing lock countdowns.

## Constraints specific to this phase

- Interest rate is **not** a package property. One global rate governs every
  investment (Phase 4, Decision 4). Do not add a rate column to `packages`.
- A user can hold multiple active investments simultaneously, each tracked with
  its own dates and its own accrual. Nothing here should assume one-per-user.
- Reinvestment (buying with Wallet B credit sourced from profit or commission) is
  fully allowed and is a normal purchase in every respect.
- The purchase must go through `postTransaction` with an idempotency key — a
  double-clicked purchase button must not create two investments.
- Ownership check on purchase (invariant #9): never trust a client-supplied user id.

## Exit test

A user with $1,000 in Wallet B buys the $1,000 package. Wallet B = 0, Wallet A =
1,000. The investment row has correct `profit_starts_at` (+7d) and
`capital_unlocks_at` (+6mo). A purchase attempt with insufficient funds is
rejected. A deactivated package no longer appears as purchasable, while an
existing investment under it is unaffected.

Run it and show the output.
