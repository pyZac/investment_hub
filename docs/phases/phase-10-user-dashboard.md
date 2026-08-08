# Phase 10 — User Dashboard

**Goal:** the polished layer — daily profit visible and satisfying.

**Prerequisites:** Phases 0–9 complete. (This phase may be interleaved earlier for
visual feedback, but never before Phase 2.)

**Read before starting:** `/docs/build_plan.md` Phase 10 section and the bilingual
requirement subsection in Part 1. Load the `frontend-design` skill for this phase.

## Deliverables

1. Overview: four wallet cards (A / B / C / SAVING) with animated count-up on daily profit.
2. Profit chart: daily accrual over time (Recharts area chart), with Friday gaps visible.
3. Investments panel: each package with lock countdown rings (6-month capital, 7-day
   profit start).
4. Binary panel: left/right volume bars, carry-forward indicator, qualification
   status (including *why* if unqualified), next-cycle countdown.
5. Interactive placement tree visualization.
6. Rank progress: current rank badge, next rank requirements with dual progress bars
   (MRV + referrals).
7. Referral centre: link, QR code, direct referrals table, commission breakdown.
8. Withdrawal page: Friday-aware, with a countdown when closed.
9. Transaction history with filters, 2-decimal display throughout.
10. **Bilingual pass**: every string routed through next-intl keys, full Arabic
    translation of all Phase 10 UI text, language switcher wired to the persisted
    user preference.

## Constraints specific to this phase

- **RTL must be verified specifically** for the tree visualization, the charts, and
  the wallet cards. Recharts and D3 do not auto-flip — these need explicit RTL
  styling and manual testing, not just `dir="rtl"` on the root.
- **Numbers stay Western Arabic numerals (0–9) in both locales.** Never Eastern
  Arabic numerals — amounts must stay unambiguous for audit and support.
- Financial terminology stays in English in the Arabic UI: Wallet A/B/C, Binary
  Commission, Direct Commission, Rank, BV, package names. Only general interface
  text, labels, instructions, and navigation translate. Keep a glossary comment
  block in the translation catalog so this stays consistent.
- Display rounding is 2dp round-half-up, at the render step only. The underlying
  8-decimal value is never mutated for display (invariant #1).
- Every data fetch enforces ownership (invariant #9) — a user must not be able to
  load another user's dashboard data by changing an id.

## Exit test

Every panel renders with real data for a seeded user. The full dashboard is walked
through in Arabic with `dir="rtl"`, and the tree, charts, and wallet cards are
confirmed visually correct in RTL — not just translated. Amounts display as 2dp
Western numerals in both locales. No hardcoded English strings remain.
