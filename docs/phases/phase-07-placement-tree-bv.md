# Phase 7 — Placement Tree & BV Rollup

**Goal:** the binary tree structure and volume propagation.

**Prerequisites:** Phase 6 complete, its exit test passed.

**Read before starting:** `/docs/mlm_rules_log.md` Section 5, specifically "Tree &
Placement Logic" and "Binary Volume (BV) Definition". `/docs/build_plan.md` Part 3
schema for `binary_nodes` and `bv_entries`, plus Part 6 items 3 and the BV-placement
follow-on implication.

## Deliverables

1. `binary_nodes` table: `user_id (1:1), parent_id, position (LEFT | RIGHT), path
   (materialized path e.g. '/1/4/9/'), depth`.
2. **Placement algorithm on registration**: BFS from the **sponsor's node**
   downward, finding the first open slot on the side with **less accumulated BV**.
   Weaker leg is measured **by BV, not member count** — this is confirmed. If both
   legs are equal or empty, either side is acceptable.
   - This requires querying summed BV per subtree at insertion time. Consider
     maintaining a cached per-node BV total rather than summing the whole subtree on
     every registration.
3. Materialized `path` maintained on insert, for fast ancestor queries.
4. **BV rollup on purchase**: walk from the buyer to the root; for each ancestor,
   determine which of its two legs contains the buyer (read from `path`), and insert
   a `bv_entry` for that ancestor + leg + amount.
5. `bv_entries` table: `id, ancestor_user_id, source_investment_id, leg, amount,
   cycle_week_start`, with `UNIQUE(ancestor_user_id, source_investment_id)`.
6. Tree visualization component (`react-d3-tree`), RTL-aware.

## Constraints specific to this phase

- **Only package purchases generate BV.** Never profits, commissions, rank rewards,
  bonus credits, or transfers. Reinvestment purchases DO generate BV like any other
  purchase.
- A purchase rolls up through **every ancestor's** tree simultaneously, not just the
  immediate parent.
- Sponsor ≠ placement (invariant #5). A user sponsored by X may be placed under Y via
  spillover. This is intentional, not a bug.
- The tree visualization does not auto-flip for RTL — it needs explicit RTL styling
  and testing.

## Exit test

Build a 4-level tree. A purchase at the bottom creates BV entries for every ancestor,
on the correct leg in each case. A commission credit creates no BV entries at all. A
new registration is placed on the lower-BV side, verified against a deliberately
imbalanced tree.

Run it and show the output.
