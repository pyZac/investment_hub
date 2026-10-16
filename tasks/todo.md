# Session: profit chart / Today's profit stat bucketing bug — DONE

## Root cause (traced precisely, not guessed)
`getDailyInterestHistoryA`, `getTodayInterestCreditA` (wallets.ts), and
`getInvestmentProfitBreakdownForUser`'s `todayProfit` (investments.ts) all
bucketed DAILY_INTEREST credits by `createdAt`. The real daily cron fires
at 00:05 Asia/Dubai — i.e. just AFTER the business day it's processing has
fully elapsed — so a row representing day D is always physically INSERTED
during day D+1's own Dubai business day. Bucketing by `createdAt`
therefore attributes every real entry to the day AFTER the one it
actually represents. Confirmed numerically (not assumed) that the row
representing "Oct 15" period has `createdAt` ~00:05 Dubai Oct 16, which
`startOfDubaiDay` buckets under Oct 16 — exactly matching the report
("today's $1.93 stat is really Oct 15's money, mislabeled").

This was invisible until now because the two dates only visibly diverge
when the "day after" bucket would otherwise be empty — which is exactly
what a Friday is (no entry can physically be created during that day's
own cron run), so the bug surfaced specifically because Oct 16 was a
Friday.

## Fix
Bucket by the idempotency key's embedded date
(`daily_interest:{userId}:{investmentId}:{YYYY-MM-DD}`) instead of
`createdAt`, in all three functions. New `businessDateFromIdempotencyKey`
helper in wallets.ts. Deliberately dropped the `createdAt`-based DB
pre-filter entirely rather than widening it: a backdated/simulated entry
(Developer Tools' "Simulate Daily Interest") can have a `createdAt`
arbitrarily far from the date it represents, so any `createdAt`-based
window — even a generously padded one — could silently miss a real
backdated entry. Fetches all DAILY_INTEREST credits for the user/wallet
and filters precisely in JS instead; row counts here are small (one row
per investment per non-Friday day), so this is cheap.

## Plan
- [x] Traced the exact mechanism numerically before writing any fix —
      confirmed with Zac that this matches what was actually observed
      (today = Oct 16, $1.93 stat is genuinely Oct 15's money).
- [x] Fixed all three affected functions: getTodayInterestCreditA,
      getDailyInterestHistoryA (wallets.ts), getInvestmentProfitBreakdownForUser
      (investments.ts). buildDailyProfitSeries (daily-profit-series.ts)
      needed NO change — it already builds its series purely from the
      `history` map it's given, which is now correctly keyed.
- [x] Considered and rejected a padded createdAt pre-filter (e.g. ±90
      days) as a perf guard — rejected because a backdated simulation's
      createdAt can be arbitrarily far from its represented date, so ANY
      createdAt-based filter risks silently dropping a real entry. Full
      per-user fetch + JS filter instead.
- [x] Rewrote wallets.test.ts's `seedInterestCredit` helper to take a real
      business date (embedded in a realistic idempotency key) separate
      from `createdAt`, defaulting `createdAt` to one Dubai day later —
      matching the real cron's actual write pattern — so the existing
      tests exercise the real bug scenario rather than coincidentally
      using matching values. Added 2 new regression tests (one per
      function) with a deliberately wild createdAt divergence.
- [x] Added 1 new regression test to investment-profit-breakdown.test.ts
      for the same createdAt-vs-idempotency-key divergence; renamed the
      existing test's stale "createdAt" framing to "idempotency-key date"
      (its fixture happened to have matching values, so it passed before
      and after, but its own description was no longer accurate).
- [x] tsc --noEmit clean.
- [x] Full suite: 647/649 passed, 1 skipped. Only failure is the already
      -documented pre-existing admin-overview.test.ts ticking-clock bug
      (hardcoded forDate in a past month vs. real wall-clock time) —
      unrelated, not touched this session.
- [x] Live verification against the real running app: reproduced the
      exact bug scenario (entry with createdAt one Dubai day after its
      represented date) via a scratch script, confirmed getDailyInterestHistoryA/
      buildDailyProfitSeries/getTodayInterestCreditA/
      getInvestmentProfitBreakdownForUser all now attribute it to the
      CORRECT day, and the following day correctly shows $0. Cleaned up
      all verification data afterward.
- [x] Lessons.md entry added — this is the FIFTH documented instance of
      the UTC/Dubai-vs-createdAt business-date bug class in this project.
- [ ] Commit + push.
