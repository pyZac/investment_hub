# Phase 6 — Sponsor Tree & Direct Commission

**Goal:** 8% to the direct sponsor, split 5% / 3%, on a referral's first purchase only.

**Prerequisites:** Phase 5 complete, its exit test passed.

**Read before starting:** `/docs/mlm_rules_log.md` Sections 3 and 4.
`/docs/build_plan.md` Part 2 Decision 4 (`commission_config` versioning) and the
`saving_lots` schema.

## Deliverables

1. `commission_config` table: `id, direct_rate, direct_commission_split,
   direct_saving_split, binary_rate, binary_carry_forward_expiry_months (default 6),
   effective_from, effective_to`. Seed: direct 8%, split 5/3, binary 8%, expiry 6 months.
2. Sponsor relationship finalised at registration (`users.sponsor_id`, already in
   place from Phase 1).
3. **Trigger: the buyer's first-ever package purchase only.** Track via
   `investments.is_first_purchase` or by checking whether it's the buyer's earliest
   investment. Subsequent purchases by the same user — including reinvestments
   funded by their own profit or commission — do **not** re-trigger Direct Commission.
4. On a qualifying first purchase, if the buyer has a sponsor, read the **currently
   active `commission_config` row** for the rate and split, then:
   - 5% (or current configured split) → CREDIT sponsor's Wallet C, immediately available
   - 3% (or current configured split) → CREDIT sponsor's SAVING wallet, and create a
     `saving_lot` with `unlocks_at = now + 3 months`
5. **One level only** — no upline propagation beyond the direct sponsor.
6. Idempotency key: `direct:{investment_id}`.
7. UI: referral link, direct referrals list, commission history.

## Constraints specific to this phase

- Sponsor tree ≠ placement tree (invariant #5). This phase touches only
  `users.sponsor_id`. The binary placement tree does not exist yet — it arrives in
  Phase 7 — and the two must never be joined by accident.
- Rate and split come from the versioned config table, never hardcoded (invariant #6).
  A later config edit must not retroactively change commissions already paid.
- Skip entirely if either party is suspended (Phase 5 rule).
- The first-purchase-only trigger here is **deliberately different** from Rank MRV
  (Phase 9), which counts every purchase. Do not unify them.

## Exit test

A referral's first $10,000 purchase gives the sponsor Wallet C +$500 and SAVING
+$300. That same referral's second purchase — any amount, any funding source —
generates **no** Direct Commission. The sponsor's own sponsor receives nothing.
Re-running with the same idempotency key creates no duplicate.

Run it and show the output.
