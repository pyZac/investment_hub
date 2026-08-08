# Phase 4 — Daily Interest Engine

**Goal:** Wallet A grows daily, at one uniform rate shared by every user's active investments.

**Prerequisites:** Phase 3 complete, its exit test passed.

**Read before starting:** `/docs/wallet_interest_audit_rules_log.md` Section 2
(Interest Calculation) in full. `/docs/build_plan.md` Part 2 Decision 2
(idempotency + catch-up), Decision 3 (time handling), Decision 4 (the
`interest_rate_config` versioning), and Part 6 items 1 and 2.

## Deliverables

1. `interest_rate_config` table: `id, monthly_rate, effective_from, effective_to
   (nullable = still active)`. Seed with 5% monthly.
2. Pure function `dailyRate(date) = activeMonthlyRate(date) / daysInMonth(date)` —
   looks up the config row active **for that date**, so historical calculations
   are reproducible. There is exactly one active rate at any moment, applying to
   every user's active investments. No per-investment or per-package rate.
3. Accrual rules, evaluated **per investment**:
   - skip if `date < investment.profit_starts_at` (the 7-day delay)
   - **skip if the date is a Friday** (skipped entirely, not accrued at zero)
   - skip entirely if the investment's owner is suspended
   - base = **that investment's own running balance** (its principal + its own
     accrued profit so far). Summing every investment's balance gives the user's
     total Wallet A balance.
4. Cron in the worker process, daily at 00:05 in `Asia/Dubai`.
5. **Catch-up logic** — the job asks "what periods are unprocessed?", not "what is
   today?". A `job_runs` table (`job_type, period_key, status, started_at,
   completed_at, error`, `UNIQUE(job_type, period_key)`) records the last
   successfully processed period. A server that was off for three days credits
   three days of interest on restart, in order.
6. Idempotency key: `daily_interest:{user_id}:{investment_id}:{date}`.
7. Ledger write as `DAILY_INTEREST` credit to Wallet A, tagged to the specific
   investment via `reference_id`, with an auto-filled comment (e.g. "Daily
   interest for Investment #123, day 14").

## Constraints specific to this phase

- **Invariant #4 is the crux of this phase**: the engine function takes
  `forDate: Date` as a parameter and never calls `new Date()` internally. The
  scheduler passes real dates; tests pass fabricated ones; same code path. This is
  testable design, not a time-travel product feature.
- Interest compounds daily on the running balance. Because ~4 Fridays per month are
  skipped, the effective monthly total lands around ~4.3% rather than exactly 5%.
  **This is accepted as intended — do not "fix" it** by adjusting the divisor.
- The divisor stays `monthly_rate / daysInMonth`.
- A rate change takes effect for **everyone** starting the next calculation. There
  is no grandfathering of old investments at an old rate. Per-investment rate
  snapshotting was explicitly considered and rejected.
- If a user withdraws profit out of A, all subsequent interest is calculated on the
  new reduced balance.

## Exit test

Unit tests running 90 fabricated days verify: nothing accrues before day 8; no
Friday accrual; compounding on each investment's own running balance; exact
expected totals to 8 decimal places. A simulated rate change mid-test correctly
changes the very next day's accrual for **every** active investment, not just ones
purchased after the change. Re-running the job for an already-processed date
creates no duplicate entries.

Run it and show the output.
