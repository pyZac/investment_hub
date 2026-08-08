# Phase 5 — Withdrawals

**Goal:** A→B and C→B self-service on Fridays; Wallet B exit requires admin approval;
capital release after 6 months.

**Prerequisites:** Phase 4 complete, its exit test passed.

**Read before starting:** `/docs/wallet_interest_audit_rules_log.md` Section 3
(Withdrawals) in full, including the account-suspension note. `/docs/build_plan.md`
Part 3 schema for `wallet_transfers`, `withdrawal_requests`, `saving_lots`.

## Deliverables

1. **Friday-only guard**, server-side, based on the configured timezone. Applies to
   both flows below. Never trust a client-side check — the client version is a UX
   convenience only.
2. **A→B and C→B (self-service, instant, no approval):**
   - A→B withdraws **profit only** while capital is locked. This requires tracking
     the capital portion of Wallet A per investment: `profit = A_balance − locked_capital`.
   - C→B withdraws the full commission wallet balance minus anything still in SAVING.
   - Both write to `wallet_transfers` and post through the ledger.
   - No minimum, no fees.
3. **B-exit ("burn", requires approval):** user submits a `withdrawal_requests` row
   with status `PENDING`; **$50 minimum enforced at submission**; no maximum cap.
   Admin reviews and approves or rejects with a mandatory comment. Only on approval
   does the ledger post: DEBIT user's B / CREDIT `SYSTEM_EXTERNAL`. Rejection leaves
   Wallet B untouched and records the admin's reason. The user request is
   Friday-only; the admin may decide on any day once submitted.
4. **SAVING unlock job:** `saving_lots` past their `unlocks_at` release into Wallet C.
5. **Capital release (A→B, principal only):** only after `capital_unlocks_at`;
   user-initiated, never automatic. Same Friday-only self-service rule — no separate
   approval for the release itself, approval applies only at the final B-exit step.
   On release, investment status → `CAPITAL_RELEASED` and it stops earning.
6. **Suspension check:** if `suspended_at` is set, block all withdrawal and transfer
   actions. Critically, the interest and commission engines (Phases 4, 6, 8, 9) must
   also check this flag and skip entirely for suspended users. A suspended user's
   leg is treated as inactive for anyone whose binary tree includes them.
7. Withdrawal UI: disabled with a countdown on non-Fridays; B-exit shows
   pending/approved/rejected status to the user.

## Constraints specific to this phase

- Capital that stays in Wallet A past the 6-month lock keeps existing as capital and
  keeps generating daily interest. Nothing forces it out — the user decides.
- Every rule here is re-enforced server-side regardless of what the client sent.
- Withdrawal approval is gated by the `WITHDRAWAL_APPROVAL` permission (invariant #8).
- Ownership checks on every request (invariant #9) — a user must never be able to
  submit, view, or cancel another user's withdrawal by guessing an id.

## Exit test

A→B and C→B transfers process instantly on a Friday with no approval step, and are
rejected Saturday–Thursday. A $200 B-exit request sits `PENDING` until an admin
approves it, at which point Wallet B decreases and `SYSTEM_EXTERNAL` reflects it. A
rejected request leaves Wallet B untouched. A $49 B-exit request is rejected at
submission. Capital withdrawal is blocked at month 5 and allowed at month 6. A
suspended user's investment accrues zero interest the day after suspension, and
their leg's active status flips to inactive for their upline.

Run it and show the output.
