# Session: Daily Interest simulator pushed investment 90 days into the future

## Findings (confirmed against real production data)

**Bug 2 ("duplicate entries") does NOT exist.** The two rows per date the
user flagged are the normal, correct double-entry pair: wallet=A/CREDIT and
wallet=SYSTEM_EXTERNAL/DEBIT, same amount (by design — debits=credits),
~5ms apart (two sequential `create()` calls inside one `$transaction`).
Confirmed directly from real column data. No code change needed for this.

**Bug 1 is real, and bigger than reported.** Three manual "Simulate 30 days"
clicks on 2026-09-29 (09:13:40, 09:20:33, 09:20:53 — ~7min then ~20s apart)
each correctly chained forward from the investment's current last-posted
date (by design — that's last session's fix for the "posts 0 entries" bug).
But nothing capped the total at real "today" — three clicks of 30 days each
pushed the investment's ledger to 2026-12-28, 90 days past where real time
actually is (2026-09-29/30). The real daily cron now finds this investment
"already processed" through Dec 28 and correctly posts nothing — which IS
the original "no new profit entries after Oct 1" symptom, fully explained,
no scheduler bug needed.

Root cause: `simulateDailyInterestDays` has no upper bound relative to the
real current date, and the UI gives no warning that a click chains forward
from wherever the ledger already is, not from "today."

## Plan — DONE (except running against production, which only Zac can do)

- [x] Add a safety cap: `simulateDailyInterestDays` now takes `today` again
      and refuses (SimulationWouldExceedTodayError, nothing written) if the
      computed `endDate` would land beyond it. Start date is still always
      last-entry+1, untouched.
- [x] New error type + UI error key + translation strings (en/ar).
- [x] Data repair script `scripts/repair-simulated-daily-interest-cmudeva3t.ts`
      for investment cmudeva3t000zmn01z8gr3ntx: reverses every DAILY_INTEREST
      transaction via the existing `reverseLedgerTransaction` (manual
      -adjustment.ts) — confirmed with Zac that Oct 1 was this investment's
      very first entry ever, so ALL of Oct 1–Dec 28 gets reversed, not just
      Dec 26-28. Append-only (no deletes), idempotent (skips
      already-reversed transactions on re-run).
- [ ] Zac to run the repair script against production (I only have the dev
      DB), then re-run `runReconciliation()` as proof.
- [x] Tests added: refuses past-today, allows exactly-on-today (boundary
      inclusive), repeated chained calls still bounded.
- [x] tsc --noEmit clean.
- [x] Full suite: Docker eventually came up. 58/60 files, 634/637 tests
      passed, 1 skipped. developer-tools.test.ts: 27/27 green (including
      the 3 new safety-cap tests), reconciliation.test.ts green. The 2
      failures (admin-overview.test.ts's "newThisMonth" assertion,
      security-headers.test.ts's /en/login timeout) are both pre-existing
      and unrelated — confirmed by stashing this session's changes and
      re-running against unmodified code: admin-overview fails identically
      with zero diff applied; security-headers passed clean on its own
      retry (a flaky 20s timeout, not a real failure).
- [x] Lessons.md entry added (2026-09-30).
- [x] Commit + push.
