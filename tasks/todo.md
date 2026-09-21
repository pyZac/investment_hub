# Session todo — 4 fixes (C wallet bug, Friday restriction, SAVING visibility, raw-ID labels)

## Status: complete

## FIX 1 — C wallet available-transfer bug — ROOT CAUSE (reported before fixing)
`withdrawableC()` in `src/lib/withdrawable.ts` subtracted the entire SAVING
wallet balance from C's balance. SAVING is a fully separate wallet, credited
independently by Direct Commission (a distinct 3% split); SAVING money only
moves INTO C when a lot unlocks (releaseOneLot debits SAVING, credits C at
that point). SAVING never sits "inside" C, so the subtraction double
-deducted money C never held. Repro matched exactly: C=$50, SAVING=$30 ->
wrongly showed $20 available. Also affected the real transferCtoB money
-moving function (used withdrawableC as its cap), not just the display.
Fix: return the full C balance, no subtraction.

## FIX 2 — Friday restriction removed for C->B
`transfers.ts`'s shared `transfer()` helper now takes `requiresFriday:
boolean` — true for transferAtoB, false for transferCtoB. UI:
`transfer-panel.tsx`'s TransferCard takes a `requiresFriday` prop so only
the A card gets Friday-gated; the C card's amount field and submit button
are always enabled. capital-release.ts and withdrawal-requests.ts (real
B-exit) keep their own independent assertFriday calls, untouched.

## FIX 3 — SAVING lot visibility
New `listSavingLotsForUser(userId)` in saving-lots.ts (read-only, no new
financial logic). New `saving-lots-list.tsx` component + a new "SAVING
lots" Card section on the withdrawals page, showing amount, lock start
date (createdAt), and release date (unlocksAt, or releasedAt if already
released) per lot, with a Locked/Released badge. Also added a SAVING
balance stat pill to the page header (previously only A/B/C were shown).

## FIX 4 — raw IDs in transaction descriptions
Ledger entries are append-only (invariant #2) — historical comment text
can never be edited. Fix computes a `description` field at READ time in
`listLedgerEntriesForUser` (transaction-history.ts), batch-fetching
package names for investment-referenced entries (DIRECT_COMMISSION,
DIRECT_SAVING, DAILY_INTEREST, CAPITAL_RELEASE) rather than showing the
raw stored `comment`. Falls back to the plain entry-type label when no
package name is found. SAVING_UNLOCK/WITHDRAWAL_OUT (no natural name
substitute) just get the plain label too — no raw id shown. `comment`
itself is kept unchanged in the return type for the admin manual
-adjustment screen, which intentionally wants the real stored text for
audit/reversal matching. Deliberately NOT touched: admin ledger-explorer.ts
and statement.ts (CSV export) — task named "transaction history" (the
user page) as the concrete target; those are separate admin/audit surfaces.

## Tests
- withdrawable.test.ts (new): 4 tests — the exact C=50/SAVING=30 regression,
  full-C-when-SAVING-empty, zero-C-regardless-of-SAVING, and a
  withdrawableProfitA guard confirming Fix 1 didn't touch Wallet A logic.
- transfers.test.ts (extended): replaced the old "C rejects on non-Friday"
  test with "C succeeds on non-Friday", added a SAVING-doesn't-reduce
  -availability regression test at the transferCtoB level; A's Friday
  rejection test is untouched and still passes.
- saving-lots.test.ts (extended): 4 new tests for listSavingLotsForUser —
  locked lot fields, released lot's releasedAt, empty array, ownership
  scoping + newest-first ordering.
- transaction-history.test.ts (extended): 5 new tests — DIRECT_COMMISSION/
  CAPITAL_RELEASE/DAILY_INTEREST descriptions contain the real package
  name and never the raw investment id, fallback to plain label when no
  investment match, SAVING_UNLOCK never exposes its raw lot id, and a
  batching check (no N+1) across multiple entries sharing one investment.

## Verification
- tsc --noEmit clean throughout.
- Full suite run twice: 576/578 and 577/578 passed (1 skipped both times).
  Both runs' only reliable failure is the pre-existing documented
  reconciliation.test.ts SYSTEM_EXTERNAL drift (-27.33841602, unrelated —
  matches the exact known artifact from earlier sessions). The first run
  also showed phase-4-exit-test.test.ts failing with a wildly different
  compounding total; investigated per the standing "don't just retry"
  bar — passed cleanly in isolation, passed cleanly on a full-suite retry,
  and none of this session's 4 fixes touch investments/job_runs/interest
  -rate-config at all (they're wallet-balance/UI/read-only changes only).
  Matches this project's already-documented SCRUM-79/SCRUM-99 hazard class
  (shared, non-isolated dev DB; a test scanning "every ACTIVE investment"
  can intermittently observe another file's transient state) rather than
  anything introduced this session.
- Manual EN+AR browser verification against the running app, real user
  with the exact C=$50/SAVING=$30 repro plus real locked/released SAVING
  lots plus a real Direct Commission purchase: withdrawals page correctly
  shows $100.00 available for C (matches live-adjusted real balance, not
  the buggy 40), C's amount field/submit enabled on a non-Friday (Monday),
  SAVING lots list renders both lots with correct dates/badges,
  transactions page shows "Direct Commission — <PackageName>" with no raw
  id in either locale. Scratch data cleaned up, reconciliation re-checked
  clean (only the known artifact).
