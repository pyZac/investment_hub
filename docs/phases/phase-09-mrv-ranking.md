# Phase 9 — MRV & Ranking Engine

**Goal:** monthly rank evaluation, one-time rewards, thresholds and rewards admin-editable.

**Prerequisites:** Phase 8 complete, its exit test passed.

**Read before starting:** `/docs/mlm_rules_log.md` Section 6 in full.
`/docs/build_plan.md` Part 2 Decision 4 (`rank_config` versioning), Part 3 schema for
`mrv_periods` and `rank_awards`, and Part 5 item 2 (the threshold concern).

## Deliverables

1. `rank_config` table: `id, rank_name, mrv_required, direct_referrals_required,
   reward_amount, reward_type (CASH | CASH_OR_TRIP), rank_order, effective_from,
   effective_to`. Seed with the 8 ranks from the rules doc (Investor → OG).
2. **MRV accrual**: **every** package purchase by a direct referral counts — new
   purchases and reinvestments alike, with no first-purchase-only restriction. Add
   the purchase amount to the **direct sponsor's** current-month MRV.
   **Depth = 1 level only** — a direct referral's own downline purchases do NOT count.
3. Monthly reset: MRV starts at 0 on the 1st of each month, no carry forward.
   `mrv_periods` with `UNIQUE(user_id, month)`.
4. Qualified direct referral count = directly sponsored users holding an active
   investment.
5. **Evaluation** reads the currently active `rank_config` rows. When both thresholds
   (MRV + referral count) are met **within the same calendar month**, grant the rank
   **immediately** and queue the reward for the next Friday cycle. All ranks also
   require the user themselves to hold an active investment.
6. Award **only the highest newly-achieved rank** in that month — lower ranks crossed
   in the same month are not separately paid.
7. `rank_awards` with `UNIQUE(user_id, rank)` — enforces once-ever at the DB level.
   Ranks are permanent, never downgraded. Re-crossing a threshold later pays nothing.
8. Reward credited to Wallet C, fully available, **no** saving split.
9. Partner rank: user chooses cash ($2,000 or currently configured amount) or a trip.
   Store the choice; a trip is a **non-cash award — logged, with no ledger credit**.
10. **Admin rank CRUD** (gated by `RANK_CONFIG`): edit MRV threshold, referral count,
    reward amount/type per rank, or add new ranks above OG. Never retroactive to
    already-granted ranks.
11. Idempotency key: `rank_reward:{user_id}:{rank}`.

## Constraints specific to this phase

- MRV's "every purchase counts, depth 1" is **deliberately different** from Direct
  Commission's "first purchase only, depth 1" (Phase 6) and from Binary's "unlimited
  rollup" (Phase 7). Three different triggers, intentionally. Do not unify them.
- MRV is independent from BV — separate tracking, separate tables.
- A rank already granted stays granted regardless of later config edits (invariant #6).
- Skip suspended users entirely.

## Open question to confirm with Zac before building

The OG rank requires 100,000,000 MRV in a single month from **direct referrals
only** — that is 1,000 purchases of the largest ($100,000) package by directly
sponsored users within 30 days. Confirm this is intentional (top ranks effectively
aspirational) rather than an oversight, before implementing. Do not silently
"fix" the thresholds or add team depth to MRV.

## Exit test

A user with 4 qualified referrals and 100,000 MRV in one month → Partner granted
immediately, $2,000 credited on the next Friday cycle, and Investor's $500 is **not**
also paid. Repeating the same performance the next month pays nothing. A Partner
choosing the trip gets a logged award with no ledger credit.

Run it and show the output.
