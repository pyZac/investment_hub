# Phase 8 — Binary Cycle Engine

**Goal:** weekly weak-leg payout with carry-forward, with expiry on volume that never gets matched.

**Prerequisites:** Phase 7 complete, its exit test passed.

**Read before starting:** `/docs/mlm_rules_log.md` Section 5 in full — especially
Qualification, Cycle, Carry Forward, Carry Forward Expiry, and the worked example.
`/docs/build_plan.md` Part 3 schema for `binary_cycles` and Part 6 item 6 plus its
follow-on implication about leg activity.

## Deliverables

1. Cycle window: **Saturday 00:00 → Friday 23:59** in `Asia/Dubai`.
2. For each user at cycle close:
   1. `left_total = carry_left_in + BV this cycle on left`; same for right.
   2. **Qualification**: the user has an active investment **and** both legs are
      active. A leg is active if *any* member anywhere in that subtree currently
      holds capital in Wallet A **and is not suspended**.
   3. If qualified: `matched = min(left, right)`, `commission = matched × currently
      active binary_rate` (from `commission_config`) → CREDIT Wallet C, fully
      available, no saving split.
   4. Carry forward: `carry_left = left − matched`, `carry_right = right − matched`
      (one of these is always 0 — the weaker leg resets to 0, the stronger leg's
      leftover carries).
   5. If **not** qualified: no payout, but volume still carries forward in full.
   6. **Carry-forward expiry**: track `carry_left_since` / `carry_right_since` — the
      week_start when the currently-carried balance first appeared unmatched, reset
      whenever that side fully matches down to 0. If a side's carry has sat unmatched
      longer than `binary_carry_forward_expiry_months` (config, default 6), the stale
      portion is dropped — not carried, not paid.
3. `binary_cycles` row per user per week — this is the audit record and the UI data
   source. `UNIQUE(user_id, week_start)`. Include `qualified` and
   `qualification_reason` so the UI can explain *why* someone wasn't paid.
4. Idempotency key: `binary:{user_id}:{week_start}`.
5. Rank rewards are also credited on the Friday cycle (built in Phase 9).

## Constraints specific to this phase

- **Leg activity is a live, dynamic status, not a one-way flag.** Releasing capital
  or an admin suspension can flip a leg from active back to inactive. Re-evaluate on
  every capital release and every suspension/reinstatement event, not just on
  deposit. This needs its own recheck job or trigger, not only an on-write check.
- Activating one leg does not guarantee payment — both legs must be active.
- The binary rate is read from the versioned config, and **historical weeks always
  use the rate that was active during that specific week** (invariant #6).
- Engine function takes the cycle dates as parameters (invariant #4).

## Exit test

The spec example: Left 15,000 / Right 7,000 → pay 8% × 7,000 = 560; the next cycle
opens Left 8,000 / Right 0. An unqualified user accrues carry but is paid nothing. A
left-leg carry that sits unmatched longer than the configured expiry window is
dropped rather than carried indefinitely; a leg that matches at any point before
expiry resets its age counter. Re-running a processed week creates no duplicate payout.

Run it and show the output.
