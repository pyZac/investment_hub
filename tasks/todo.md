# Session: "Today" profit stat -> "Last posted" (most recent DAILY_INTEREST credit)

## Scope (confirmed with Zac)
Two existing "Today" stats both change to "Last posted" semantics:
1. Per-investment breakdown panel (`profit-breakdown-panel.tsx` /
   `getInvestmentProfitBreakdownForUser`, investments.ts) — per the task's own
   wording ("this investment's wallet A").
2. Wallet A card footer (`TodayProfitFooter` / `getTodayInterestCreditA`,
   wallets.ts) — dashboard-wide total across all of the user's investments.

New semantics for both: the amount of the single most recently posted
DAILY_INTEREST CREDIT entry (wallet A), not a sum over "today." "Most recent"
= highest idempotency-key business-date (`daily_interest:{userId}:{investmentId}:
{YYYY-MM-DD}`), not `createdAt` — same reasoning as the existing
`businessDateFromIdempotencyKey` helper already uses throughout this file, since
`createdAt` lags the business day by one day for the real cron (see lessons.md
2026-10-16 entry). If no DAILY_INTEREST credit exists yet (investment still in
its 7-day waiting period, or user has none), show $0.00 as before.

## Plan
- [ ] `wallets.ts`: add `getLastPostedInterestCreditA(userId)` — returns the
      amount of the single most recent DAILY_INTEREST CREDIT (wallet A) across
      all the user's investments, picked by idempotency-key business date, or
      null if none exist. No `forDate` param needed (this is "most recent
      ever," not day-bucketed) — but still no `new Date()` call internally.
      Keep `getTodayInterestCreditA`/`getDailyInterestHistoryA` as-is (the
      chart still needs real day-bucketed sums).
- [ ] `investments.ts`: add `lastPostedProfit: Prisma.Decimal | null` to
      `InvestmentProfitBreakdownRow`, computed per-investment the same way
      (most recent DAILY_INTEREST CREDIT for THAT investment specifically, by
      idempotency-key date) inside `getInvestmentProfitBreakdownForUser`.
      Keep `todayProfit` field removed (fully replaced, not kept alongside) —
      confirm this is really a replacement, not an addition, since the task
      says "change," not "add."
- [ ] `dashboard/page.tsx`: swap `getTodayInterestCreditA` call for
      `getLastPostedInterestCreditA`.
- [ ] `wallet-card.tsx`: rename `TodayProfitFooter` -> `LastPostedProfitFooter`
      (or keep the component name and just change label text/prop semantics —
      decide while implementing, minimal diff preferred).
- [ ] `profit-breakdown-panel.tsx`: swap `row.todayProfit` ->
      `row.lastPostedProfit`, handle null -> $0.00 display.
- [ ] Translation keys (messages/en.json, messages/ar.json): rename
      `todayProfitLabel`/`profitBreakdownTodayLabel` text to "Last posted" (EN)
      and Arabic equivalent. Keep key names stable where possible to minimize
      diff, just change the string values — unless the key name itself is now
      misleading, in which case rename the key too and update every reference.
- [ ] Update tests: `wallets.test.ts` (new describe block for
      `getLastPostedInterestCreditA`, remove/adapt the old
      `getTodayInterestCreditA` tests that only existed for this UI purpose —
      but don't delete `getTodayInterestCreditA` itself since the chart still
      uses it), `investment-profit-breakdown.test.ts` (same).
- [ ] Fix stale doc comments while here (investments.ts lines ~198-202 already
      say "idempotency key" is used but still reference the old `todayProfit`
      framing — update to `lastPostedProfit`).
- [x] tsc --noEmit clean (after clearing stale .next/types per the standing
      known quirk).
- [x] Full suite: 638/648 passed, 1 skipped, 9 failed across 5 files — none
      in files touched this session. Re-ran every failing file in isolation:
      all passed clean (binary-tree.test.ts, rank-evaluation-job.test.ts,
      security-headers.test.ts — transient timeouts under full-suite system
      load) except admin-overview.test.ts/phase-4-exit-test.test.ts, which
      are the already-documented ticking-clock design flaw (lessons.md
      2026-09-28 entry — hardcoded past-month fixtures racing real wall
      -clock time). Re-ran wallets.test.ts + investment-profit-breakdown.test.ts
      (the two files this session changed) standalone: 23/23 passed.
- [x] No lessons.md entry needed — no unexpected correction, matched plan.
