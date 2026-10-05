# Session: Per-investment profit breakdown on the user dashboard — DONE

## Plan
- [x] New `getInvestmentProfitBreakdownForUser(userId, forDate)` in
      investments.ts: per-active-investment `todayProfit` (Dubai business
      day, via `startOfDubaiDay`) and `totalProfit` (all DAILY_INTEREST
      CREDIT minus any reversal). Ownership-scoped via
      `listActiveInvestmentsForUser` — no admin bypass.
- [x] Real finding, not assumed: a DAILY_INTEREST reversal (the only write
      path is `reverseLedgerTransaction`, manual-adjustment.ts) is NOT
      tagged `referenceType: "investment"` like the original — it's
      `entryType: "ADMIN_ADJUSTMENT"`, `referenceType: "manual_adjustment"`,
      `referenceId` = the ORIGINAL idempotencyKey. A naive
      `referenceType: "investment"` filter on "total profit" would have
      silently ignored every reversal (ticket's own wording named a
      "REVERSAL" entryType that doesn't exist in the schema at all).
      Reversals are found by `referenceType: "manual_adjustment"` +
      `referenceId` prefix-matching the investment's own idempotency-key
      format. Verified this is a REAL scenario, not hypothetical — exactly
      this reversal happened to investment cmudeva3t000zmn01z8gr3ntx last
      session (tasks/lessons.md, 2026-09-30 entry).
- [x] New `ProfitBreakdownPanel` Server Component — row-card list (not a
      raw `<table>`), matching `TransactionList`/`InvestmentList`'s
      established pattern. Package name + amount shown together (name is
      an admin-chosen label, not necessarily the dollar figure).
- [x] Wired into dashboard/page.tsx between the wallet cards grid and the
      chart card. Did not touch `getTodayInterestCreditA`/
      `getDailyInterestHistoryA`/the chart — both untouched, per the
      ticket's explicit "do not change" instruction.
- [x] EN/AR translations added (Dashboard namespace). Package name stays
      untranslated (proper noun), "package"/dates/labels translated,
      Western numerals throughout, `dir="ltr"` on every amount span,
      `text-end` (logical) for numeric-column alignment.
- [x] Tests: 7 new tests in investment-profit-breakdown.test.ts — empty
      case, basic fields, CAPITAL_RELEASED exclusion, Dubai-day boundary
      (fixture near the UTC/Dubai edge, per the standing lesson), reversal
      subtraction (the critical case), cross-user isolation, multi
      -investment independence. All pass.
- [x] Live verification against the real running app (no browser-driving
      tool available in this environment — used a scratch script: real
      user, real purchases, real seeded credits, real HTTP login, fetched
      the real rendered HTML for both /en/dashboard and /ar/dashboard).
      Confirmed: both package names render, both profit figures render
      correctly formatted, correct heading per locale, no locale leaking
      the other's text, dir="ltr" wrapping present in the actual HTML,
      Arabic translation and Western numerals confirmed in the real
      response body. Scratch script + its test data fully cleaned up
      afterward (investments, ledger entries via
      cleanupLedgerEntriesForUsers, packages, sessions, wallets, security
      questions, users — verified 0 remaining).
- [x] tsc --noEmit clean.
- [x] Full suite: 3 failures, all confirmed pre-existing/unrelated —
      admin-overview.test.ts and security-headers.test.ts are the same two
      flaky/pre-existing failures from the prior session; rank.test.ts's
      timeout (new this run) was re-verified in isolation alongside the
      new test file and passed clean in 5876ms — confirmed suite-load
      flakiness (the standing CPU-bound-under-parallel-load pattern), not
      a regression; neither file touches anything this session changed.
- [ ] Commit + push.
