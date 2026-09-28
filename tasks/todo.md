# Session: "Simulate N days of Daily Interest" in Developer Tools

Confirmed with user before building: simulation targets ONE specific
investment (admin picks/enters it), never every active investment
platform-wide. The ticket's literal wording ("loop N times, calling the
accrual function") would, if it mirrored runDailyInterestCatchUp's
"every ACTIVE investment" loop, post real permanent interest to every
real user's real Wallet A — the exact SCRUM-54 hazard already in
lessons.md (a fabricated-date sweep corrupted a real balance to ~511M in
an earlier phase). Scoping to one explicitly-chosen investment removes
that blast radius entirely while still testing the real accrual function,
real compounding, and real idempotency behavior.

## Corrected understanding of the accrual function
`accrueDailyInterestForInvestment(investmentId, forDate)` in
src/lib/daily-interest.ts ALREADY takes `forDate: Date` as a required
parameter (invariant #4 — no `new Date()` inside engine functions was
ever violated here). The ticket's step "if it doesn't already accept a
date override, add one" doesn't apply — no change needed to this
function's signature at all. The "unique date -> unique idempotency key"
requirement is also already satisfied by construction: the idempotency
key embeds `dateKey(forDate)`, so distinct fabricated dates naturally
produce distinct keys with zero extra code.

## Date iteration
"day 1 = oldest, day N = today" -> for i in 1..N, date_i = today - (N - i)
days, so date_N = today (i=N -> offset 0) and date_1 = today - (N-1) days.
Iterate oldest-to-newest so compounding accrues in the correct order
(day 1's credit must exist before day 2's running-balance read).

## Backend
- [ ] New `simulateDailyInterestDays(actingAdminId, investmentId, days,
      today)` in src/lib/developer-tools.ts: DEVELOPER_TOOLS-gated, N in
      [1,30], loops oldest-to-newest calling
      `accrueDailyInterestForInvestment(investmentId, date_i)` for real
      (this DOES write real ledger entries for this ONE investment/user —
      that's the whole point of testing real compounding — but scoped to
      an investment the admin explicitly chose, not a sweep). Tallies
      `entriesPosted` (only non-skipped, non-alreadyProcessed results
      count as newly posted) and `totalCredited` (sum of `.amount` for
      those). Logs a new `DAILY_INTEREST_SIMULATED` admin_actions row
      (reason includes investmentId + days) — this is exactly the kind of
      action that must be attributable per invariant #8, doubly so since
      it writes real ledger entries.
  - [ ] Need a small lookup helper too: `findInvestmentForSimulation(actingAdminId,
        investmentId)` — returns investment + owner name/email + package
        name so the UI can show "you are about to simulate interest for
        <name>'s <package> investment" before the confirm dialog, so an
        admin doesn't fire this blind at a raw ID typo.
- [ ] New `AdminActionType` enum value: `DAILY_INTEREST_SIMULATED`. Add to
      security-log.ts's `ADMIN_ACTION_TYPE_LABELS` (exhaustive
      Record<AdminActionType,...> — tsc enforces this, confirmed pattern
      from the last two sessions).
- [ ] Route: ticket asks for `POST /api/admin/developer-tools/simulate-daily-interest`
      — but this app has ZERO other /api/admin/* routes (confirmed
      earlier session); every admin action goes through Server Actions.
      DECISION: use a Server Action in
      src/app/[locale]/admin/developer-tools/actions.ts, consistent with
      every other action on this page and this whole admin panel, same
      choice already made for the job-trigger/Friday-bypass actions on
      this exact page. Not re-litigating this per-session — it's the
      established convention now.
- [ ] `actions.ts`: `lookupInvestmentForSimulationAction(investmentId)`,
      `simulateDailyInterestAction(investmentId, days, locale)` —
      `requirePermission("DEVELOPER_TOOLS", ...)` first, mirrors the
      page's existing action shapes exactly.

## Frontend
- [ ] New `daily-interest-simulator.tsx` component, rendered inside the
      existing Daily Interest job row (or just below the job table) on
      /admin/developer-tools:
      - investment ID text input + "Look up" button -> shows owner
        name/email, package name, current status once found
      - number input for days (default 7, min 1, max 30) — only enabled
        once an investment is successfully looked up
      - "Simulate N days" button -> confirmation dialog with the exact
        warning text from the ticket, showing which investment/owner it
        will affect
      - after running: show the summary (daysProcessed, entriesPosted,
        totalCredited)
- [ ] Translations: new keys in AdminDeveloperTools (en.json + ar.json).

## Verification
- [x] tsc --noEmit clean
- [x] New tests in developer-tools.test.ts (10 new tests): permission
      gate, correct date sequence + compounding, correct
      entriesPosted/totalCredited tally (including Friday-skip), 
      idempotent replay, audit log written, does NOT touch any other
      investment/user's balance
- [x] Found + fixed a real precision bug during test-writing (see
      lessons.md): totalCredited now re-reads persisted rounded ledger
      amounts instead of trusting accrueDailyInterestForInvestment's
      pre-rounding return value. Confirmed with user: fixed locally in
      the new code only, did not touch the real accrual function.
- [x] Full suite: 621/627 passing. 2 unrelated, pre-existing test files
      (daily-interest-job.test.ts, phase-4-exit-test.test.ts — zero diff
      this session) now fail purely from real calendar time (2026-09-28)
      having advanced past their hardcoded August 2026 fabricated dates
      and colliding with the real worker's real job_runs progress.
      Confirmed with user: documented in lessons.md, left both files
      untouched, out of scope for this ticket.
- [x] Commit + push
