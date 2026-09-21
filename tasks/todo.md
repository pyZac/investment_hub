# Session todo — $ + comma formatting for all displayed monetary amounts

## Status: complete

## Approach
Added `toDisplayWithCurrency()` to `src/lib/display.ts`, built on top of the
existing `toDisplay()` (reuses its round-half-up 2dp rounding, no
duplicated Decimal logic). `toDisplay()` itself is UNCHANGED — several
call sites feed its output straight into `Number(...)` for live form
validation/math (withdrawable caps, zero-checks, progress-bar widths) or
into an editable `<input>`'s initial value (package/rank edit dialogs);
a "$10,000.00" string would parse as NaN there, silently breaking
withdrawal limits and edit forms. This was the key finding driving the
whole approach: swap only the call sites that are genuinely display-only,
never a shared prop also used for parsing or editing.

For every dual-use case found (transfer-panel.tsx, transfer-form.tsx,
b-exit-form.tsx, binary-panel.tsx x2, rank-progress-panel.tsx,
package-list.tsx, rank-list.tsx), the fix formats only at the actual
render spot inside the component, leaving the underlying prop/state
plain so Number()/editable-input logic keeps working unchanged.

Left deliberately untouched (data-interchange, not UI screens):
statement.ts's CSV export, admin ledger-explorer.ts's raw CSV export.
Commission/interest-rate config screens' percentage figures (%) are not
dollar amounts and were confirmed unaffected.

Also fixed as a side effect: `wallet-card.tsx` and `credit-form.tsx` etc.
had hardcoded raw un-rounded 8-decimal-place amounts in several admin
list screens (`recent-credits-list`, `pending-queue`, `decision-history`,
`package-list`, `user-detail-panel`, `rank-list`, `rank-history-list`) —
these weren't just missing commas, they were never rounded to 2dp
display precision at all. All fixed as part of this same sweep.

## Files touched (36 non-test files + display.ts/display.test.ts)
User-facing: dashboard, packages, investments, withdrawals, transfer,
transactions, referrals, ranking, binary-tree pages/components.
Admin-facing: overview, credits, withdrawals, packages, rank-config,
solvency, users, ledger, manual-adjustment pages/components.

## Tests
display.test.ts: 15 new tests for toDisplayWithCurrency — comma at 1000
boundary, multiple commas for millions, no comma under 1000, zero,
negative-value sign-before-$ ordering, half-up rounding through the
currency formatter, string input, idempotent re-formatting of an
already-2dp string, non-mutation of the source Decimal, and a regression
guard confirming toDisplay's own output is completely unchanged.

## Verification
- tsc --noEmit clean.
- Full suite: 593 passed, 1 pre-existing documented reconciliation
  exception (drift -27.33841602, same known artifact as every prior
  session — unrelated to this UI-only change), 1 skipped.
- Manual EN+AR browser verification with a real user funded across all
  4 wallets (up to $1,000,000) plus a real Direct Commission payout:
  dashboard, packages, withdrawals, transfer, and transactions pages all
  show correctly comma-formatted "$X,XXX,XXX.XX" amounts in both
  locales, Western numerals preserved in Arabic, sign+$ ordering
  confirmed correct under dir="ltr" wrappers (e.g. "+$625.00", not
  "625.00+$" or "$+625.00"), and the transfer-amount `<input>` field
  confirmed to remain plain/editable (not pre-filled with a
  currency-formatted, unparseable string). Scratch data cleaned up,
  reconciliation re-checked clean (only the known artifact).
