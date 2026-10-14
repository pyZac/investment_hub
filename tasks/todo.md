# Session: profitStartsAt timezone-boundary bug + Oct 13 backfill — DONE

## Finding before implementing (changed the fix from what was literally asked)
The report asked for `startOfUtcDay(forDate) < startOfUtcDay(profitStartsAt)`
— a plain UTC-calendar-day comparison. Traced a concrete boundary case
(investment purchased at 01:00 Asia/Dubai) where that gives the OPPOSITE,
WRONG answer compared to a Dubai-business-day comparison — every other
boundary in this engine (isFriday, dailyRate) already resolves in Dubai
terms, not UTC. Confirmed with Zac to use `startOfDubaiDay` (business-day.ts)
instead of the UTC-day version the report specified.

## Plan
- [x] Confirmed the bug is real: `forDate < investment.profitStartsAt` is a
      plain instant comparison; `profitStartsAt = purchasedAt + 7 days`
      preserves purchasedAt's real time-of-day (not midnight-normalized),
      while the real scheduler's `forDate` is always Dubai-midnight
      -aligned (daily-interest-job.ts's `startOfUtcDay` truncation) — so a
      purchase at any non-midnight time skipped its correct first eligible
      day.
- [x] Fixed via `startOfDubaiDay(forDate) < startOfDubaiDay(profitStartsAt)`
      in daily-interest.ts, with a comment explaining why Dubai-day (not
      UTC-day) and documenting the ruled-out boundary case.
- [x] Added 2 regression tests to daily-interest.test.ts using a
      non-midnight purchasedAt (10:22:52 UTC) — one proving day 8 now
      accrues, one proving day 7 still correctly skips. Every PRE-EXISTING
      fixture in this file used exact-midnight purchasedAt values, which
      is exactly why this bug was invisible to the existing suite (same
      "midnight-only fixtures hide a real timezone bug" pattern already
      flagged twice in lessons.md).
- [x] Real scare, resolved: `phase-4-exit-test.test.ts` failed ONCE on an
      early combined run (`1084.00302945` vs expected `1180.67317771`).
      Root-caused properly rather than assumed: ran the exact scenario via
      a standalone debug script bypassing vitest entirely — old code and
      new code produced IDENTICAL results (`1147.61830399`). Re-ran the
      real test file alone, combined with daily-interest-job.test.ts,
      and the full suite — all passed clean, repeatedly, with the fix in
      place. Confirmed this was a one-off DB-state artifact from the
      debugging session itself (likely a scratch job_runs check script
      running too close to a prior test invocation), not a real
      regression — never reproduced again across 4 separate re-runs.
- [x] tsc --noEmit clean throughout.
- [x] Full suite: 642/646 passed, 1 skipped. The only 2 failures are the
      already-documented pre-existing flaky ones (admin-overview.test.ts's
      ticking-clock forDate bug, security-headers.test.ts's HTTP timeout)
      — neither touches daily-interest.ts.
- [x] Oct 13 backfill: wrote `scripts/backfill-oct13-profit-start-bug.ts`
      (--dry-run/--execute). Deletes the single job_runs row for
      (daily_interest, "2026-10-13") rather than hand-posting a ledger
      entry — lets the real catch-up loop replay that date through the
      real, now-fixed engine code for every active investment, which is
      idempotent per-investment (existing entries' idempotency keys
      already exist, so nothing double-posts; only investments this bug
      actually skipped get a new entry). Verified end-to-end against dev
      DB: no-row case, seeded-COMPLETED-row dry-run, and real execute
      -then-confirm-deleted, all behave correctly.
- [x] Lessons.md entry added.
- [ ] Commit + push (daily-interest.ts fix + tests). The backfill script
      itself: confirm with Zac whether to commit it (prior repair scripts
      were committed) or keep it untracked like reset-platform-data.ts —
      this one isn't flagged "do not commit" so defaulting to committing
      it, matching repair-simulated-daily-interest-cmudeva3t.ts's own
      precedent, unless told otherwise.
