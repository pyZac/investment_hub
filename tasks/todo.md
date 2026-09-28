# Session: Fix simulateDailyInterestDays posting 0 entries / $0.00

Root cause confirmed: the function always builds its N-day window ending at
`today` (`offsetDays = days - i`, `simulatedDate = today - offsetDays`). If
those calendar dates already have a DAILY_INTEREST ledger entry for this
investment (e.g. re-running the simulation, or the real daily cron already
caught the investment up to today), `postTransaction`'s idempotency-key
collision makes every iteration a silent no-op replay
(`alreadyProcessed: true`), so `entriesPosted` stays 0 and `totalCredited`
stays $0.00 — not a crash, just silently correct-looking zero output.

## Plan
- [ ] In `simulateDailyInterestDays` (src/lib/developer-tools.ts), before
      building the date range: query `ledgerEntry` for this investment's
      latest DAILY_INTEREST CREDIT entry (`referenceType: "investment",
      referenceId: investmentId, entryType: "DAILY_INTEREST", wallet: "A",
      direction: "CREDIT"`, `orderBy: { createdAt: "desc" }` or derive from
      the idempotency key's date — use `createdAt` desc `take: 1`, but the
      actual calendar date simulated is what matters, so read it back via
      the comment/dayNumber... simplest: aggregate isn't enough, need the
      actual latest date. Store DAILY_INTEREST dates in a way we can recover
      the calendar date: the idempotency key embeds `YYYY-MM-DD` at the end
      — parse it, OR just track the max `forDate` some other way. Simplest
      robust approach: since we don't store forDate as a column, use
      `createdAt` of the ledger entry as a proxy for the simulated date is
      WRONG when simulating backdated days (createdAt = real now, not the
      fabricated date). Must parse the date out of `idempotencyKey`
      (format: `daily_interest:{userId}:{investmentId}:{YYYY-MM-DD}`,
      already treated as a stable contract elsewhere in this file) — find
      the entry with the lexicographically max date suffix among rows
      matching this investment.
- [ ] Start the injected range at (last existing date + 1 day). Fall back to
      `investment.purchasedAt + 8 days` if no prior DAILY_INTEREST entry
      exists for this investment (day 8 = one day after the 7-day wait per
      the existing dayNumber comment convention).
- [ ] Range is always `[startDate, startDate + days - 1]`, i.e. no longer
      anchored to `today` at all — simulated days are always the N days
      right after the last real/simulated day on record.
- [ ] Add `simulatedFrom`/`simulatedTo` (or similar) to
      `SimulateDailyInterestResult` and return them so the admin UI can
      show "Simulated Sep 21 - Sep 27".
- [ ] Update the Server Action / UI caller if the result shape change needs
      surfacing (check actions.ts and the results display component).
- [ ] Update/add tests for developer-tools.ts covering: fresh investment
      (no prior entries) starts at purchasedAt+8; investment with existing
      DAILY_INTEREST entries continues from last+1 and produces nonzero
      entriesPosted/totalCredited on a second simulation call; returned
      date range matches what was simulated.
- [ ] tsc --noEmit clean, run affected test file(s).
- [ ] Commit + push.
