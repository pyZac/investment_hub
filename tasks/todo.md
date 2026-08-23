# Phase 9 — MRV & Ranking Engine

## Open question — RESOLVED before any building started
Asked Zac directly: OG rank's 100,000,000 MRV/month (direct referrals only,
~1,000 Elite-package purchases in 30 days) — intentional (top ranks
aspirational) or needs revisiting? **Answer: intentional, build exactly as
documented.** No threshold changes, no added team depth to MRV. This matches
build_plan.md Part 5 item 2's own framing of the same open question.

## Research findings (from Explore agent, informs design below)
- `RANK_CONFIG` already exists in the `AdminPermission` enum
  (schema.prisma:27) — unused by any code yet.
- `LedgerEntryType.RANK_REWARD` already exists in the enum
  (schema.prisma:133) — use directly, don't add a new one.
- `mrv_periods`, `rank_awards`, `rank_config` do NOT exist in schema yet —
  confirmed via grep.
- Versioned-config pattern to copy exactly: `CommissionConfig` shape
  (id, ...fields, effectiveFrom, effectiveTo nullable, no `@@unique` in
  Prisma DSL) + hand-written migration index
  `CREATE UNIQUE INDEX ..._one_active ON ((TRUE)) WHERE effective_to IS NULL`
  — NEVER index the nullable column itself (that was the SCRUM-48 bug).
  Lookup pattern at call sites: `findFirstOrThrow({ where: { effectiveTo: null } })`.
- Direct Commission idempotency key shape to mirror:
  `{prefix}:{id}:{suffix}` — Phase 9 uses `rank_reward:{user_id}:{rank}`
  per the phase brief, consistent with this shape.
- **No existing "grant now, pay later" mechanism anywhere in the codebase**
  — binary commission computes and credits in the same job run. Phase 9
  introduces this pattern fresh: `rank_awards.credited_at` nullable =
  granted-but-not-yet-paid; a separate weekly Friday sweep job credits it.
- `job_runs` catch-up pattern (binary-cycle-job.ts, copied near-verbatim for
  the monthly MRV job): `unprocessedPeriods(today)` — if no prior COMPLETED
  row exists, start = end (only the most recently closeable period), NEVER
  walk back to a hardcoded epoch (SCRUM-52 lesson). periodKey for a monthly
  job = `"YYYY-MM"` (Asia/Dubai calendar month).
- Permission gating: `requirePermission("RANK_CONFIG", forDate)` from
  `route-guard.ts`, same pattern as any other gated admin action.
- Test convention: co-located `src/lib/<name>.test.ts`. Every test that
  writes ledger entries must clean up via `cleanupLedgerEntriesForUsers`
  (test-helpers.ts) — idempotencyKey-scoped, SYSTEM_EXTERNAL-safe.
- New tables with RESTRICT FKs to `users` require grepping
  `<model>.deleteMany` across `*.test.ts` before finalizing schema (SCRUM-70/71
  lesson) — applies to `mrv_periods` and `rank_awards` (both FK -> users).
- Never run two DB-writing processes concurrently against the shared dev DB
  (SCRUM-79/81).

## Design decisions to confirm with Zac before coding

1. **Schema**: three new tables —
   - `rank_config`: id, rank_name, mrv_required Decimal(24,8),
     direct_referrals_required Int, reward_amount Decimal(24,8),
     reward_type (CASH | CASH_OR_TRIP), rank_order Int, effective_from,
     effective_to (nullable) — versioned exactly like `commission_config`,
     with the same `((TRUE))`-expression partial unique index scoped
     **per rank_name** (i.e. at most one active row per rank_name, NOT a
     single global active row — unlike commission_config, multiple ranks
     must be simultaneously active). Index:
     `CREATE UNIQUE INDEX rank_config_one_active_per_rank ON rank_config (rank_name) WHERE effective_to IS NULL`
     — this one legitimately CAN index the real column since `rank_name`
     is never null (not the NULL-column trap from the SCRUM-48 lesson,
     since uniqueness here is meant to be "one active row per distinct
     rank_name value," not "at most one row total").
   - `mrv_periods`: user_id (FK -> users, RESTRICT), month (text
     "YYYY-MM"), volume Decimal(24,8), qualified_direct_referrals Int,
     UNIQUE(user_id, month).
   - `rank_awards`: user_id (FK -> users, RESTRICT), rank (text, matches
     rank_config.rank_name), achieved_month, reward_amount Decimal(24,8),
     reward_choice (CASH | TRIP, nullable — only meaningful for Partner),
     credited_at (nullable timestamp), idempotency_key (unique text,
     `rank_reward:{user_id}:{rank}`), UNIQUE(user_id, rank).
2. **Two jobs, not one**:
   - Monthly MRV evaluation job (`job_type: "mrv_evaluation"`,
     periodKey `"YYYY-MM"`): for every month boundary crossed, computes
     each qualifying user's MRV + qualified-direct-referral-count for that
     completed month, evaluates against active rank_config rows, grants
     the single highest newly-achieved rank (rank_awards row,
     credited_at: null) per user.
   - Weekly Friday payout sweep (new job, reuses the Saturday-week-start
     cadence already established, or triggers Friday-specific — TBD at
     implementation time to match `daysUntilNextFriday`'s existing
     Friday concept): sweeps `rank_awards` where `credited_at IS NULL`
     AND `reward_choice != 'TRIP'` (or reward_type from rank_config is
     CASH), credits Wallet C via `postTransaction`, sets `credited_at`.
   - Reasoning: MRV evaluation is inherently monthly (calendar-month
     volume); reward payout is inherently weekly (Friday cycle) — these
     are different cadences and mixing them into one job_runs periodKey
     scheme would be incorrect.
3. **MRV accrual mechanism**: is this computed on-the-fly by the monthly
   job (summing `investments.purchasedAt` within the month, joined to
   `users.sponsorId`), or accrued incrementally into `mrv_periods` at
   purchase time (mirroring how `bv_entries` accrues at purchase time)?
   Leaning toward **incremental accrual at purchase time** (mirrors the
   bv_entries pattern already established in Phase 7, avoids a heavy
   full-month scan, and naturally supports "every purchase counts" without
   re-deriving it later) — `purchasePackage` increments the direct
   sponsor's current-month `mrv_periods` row (upsert) by the purchase
   amount, every purchase, no first-purchase-only gate. The monthly job
   then only evaluates already-accrued `mrv_periods` rows against
   rank_config, it doesn't compute volume itself.
4. **Qualified direct referral count**: computed at evaluation time (not
   accrued incrementally) — count of `users` where `sponsorId = user.id`
   AND has an investment with `status: ACTIVE` at month-end. This is a
   point-in-time count, not cumulative, so accruing it incrementally
   would need re-evaluation anyway; direct query at evaluation time is
   simpler and avoids a cache to keep in sync with capital-release/
   suspension events (same reasoning as `isLegActive` in Phase 8, no
   caching, pure live read at the decision point).

## Plan

- [x] Present schema design (rank_config, mrv_periods, rank_awards) to Zac,
      confirm before writing migration. Approved as proposed; scoped down to
      building rank_config alone first (SCRUM-83), mrv_periods and
      rank_awards deferred to their own upcoming tickets for incremental
      review.
- [ ] Confirm the two-job split (monthly MRV eval vs. weekly Friday payout
      sweep) and the incremental-accrual-at-purchase-time approach.

## SCRUM-83: rank_config table — DONE

- [x] Added `RankConfig` model + `RankRewardType` enum (CASH |
      CASH_OR_TRIP) to schema.prisma, matching `CommissionConfig`'s
      versioned shape (id, ...fields, effectiveFrom, effectiveTo nullable,
      no `@@unique` in Prisma DSL — hand-written index instead). Key
      difference from CommissionConfig/InterestRateConfig: uniqueness is
      "at most one active row PER rank_name," not a single global active
      row, since all 8 ranks must be simultaneously active. Index is on
      the real (never-null) `rank_name` column itself, scoped by
      `WHERE effective_to IS NULL` — this is NOT the NULL-column trap from
      the SCRUM-48 lesson (that bug was indexing a column that's NULL on
      every qualifying row; rank_name is always a real string, so two
      active rows for the same rank genuinely collide on this index).
- [x] Hand-written migration `20260822130000_add_rank_config` (mirrors
      `20260821120000_add_commission_config`'s exact structure — table,
      partial unique index, seed INSERT all in the same migration file,
      same as commission_config's own precedent) + `migrate deploy` +
      `prisma generate` (standing rule — no `migrate dev` since Phase 2).
- [x] Seeded all 8 ranks from mlm_rules_log.md Section 6 exactly: Investor
      (25,000 / 2 / $500 CASH), Partner (100,000 / 4 / $2,000
      CASH_OR_TRIP), Executive (500,000 / 6 / $10,000 CASH), Director
      (2,000,000 / 8 / $40,000 CASH), President (7,500,000 / 10 /
      $150,000 CASH), Chairman (20,000,000 / 12 / $400,000 CASH),
      Visionary (50,000,000 / 15 / $1,000,000 CASH), OG (100,000,000 / 20
      / $2,000,000 CASH) — confirmed by direct `psql` query against the
      real table, all 8 rows match the doc exactly.
- [x] Verified the partial unique index actually enforces what's intended
      (per the standing "don't trust the index exists, prove it" rule
      from the SCRUM-48 lesson), not just assumed from `\d rank_config`:
      (1) inserting a second active ("Investor", effective_to NULL) row
      correctly fails with a real constraint violation; (2) inserting a
      second NON-active ("Investor", effective_to set) row correctly
      succeeds (versioning must still allow closed historical rows); (3)
      inserting a second active row for a DIFFERENT rank_name ("OG2")
      correctly succeeds alongside all 8 real ranks staying active
      simultaneously — proving this is genuinely a per-rank constraint,
      not accidentally a global one. All test rows deleted immediately
      after each check; confirmed exactly 8 rows remain in rank_config.
- [x] `prisma migrate status` clean (27 migrations). `tsc --noEmit` clean.
      `\d rank_config` confirmed real table structure matches schema
      exactly (all Decimal(24,8) columns, RankRewardType enum column,
      both indexes present).
- [x] Full suite: 38 files, 271/271 passing (same count as before this
      change — schema-only migration, no new lib/test files yet).
      `reconciliation.test.ts` re-run standalone as final proof, 3/3
      passing clean.

Schema only — no engine logic (MRV accrual, evaluation, rank CRUD) yet;
that's `mrv_periods`/`rank_awards` and their own upcoming tickets, per
Zac's explicit request to review each incrementally rather than build all
three tables at once.

## SCRUM-84: mrv_periods table + MRV accrual logic — DONE

- [x] Added `MrvPeriod` model to schema.prisma (userId FK -> users RESTRICT,
      month "YYYY-MM" text, volume Decimal(24,8) default 0,
      qualifiedDirectReferrals Int default 0 — written by the monthly
      evaluation job, a later ticket, not this one — UNIQUE(userId, month)).
      Uses the SPONSOR tree only, never the placement tree (invariant #5).
- [x] Hand-written migration `20260822140000_add_mrv_periods` (mirrors
      `20260822100000_add_binary_cycles`'s exact structure) + `migrate
      deploy` + `prisma generate`.
- [x] `src/lib/rank.ts`: `dubaiMonthKey(forDate)` (mirrors
      `saturdayWeekStart`'s Intl.DateTimeFormat/Asia-Dubai pattern from
      binary-cycle.ts — a UTC-day date can already be the 1st of the next
      month in Dubai, so this can't be a raw `toISOString()` slice) +
      `accrueMrvForPurchase(buyerId, amount, forDate, tx)`: reads the
      buyer's `sponsorId` directly off `users` (depth 1, no ancestor walk —
      genuinely different from BV's unlimited placement-tree rollup), no-ops
      for a buyer with no sponsor, upserts the sponsor's current-month
      mrv_periods row incrementing `volume`. Every purchase counts, no
      first-purchase-only gate (deliberately different from Direct
      Commission's isDirectCommissionTriggerPurchase — doc comment on both
      functions cross-references the other so this isn't accidentally
      "unified" later). `tx` required, not optional, same reasoning as
      rollupBvForPurchase/payDirectCommissionInTx.
- [x] Wired into `purchasePackage` (`src/lib/investments.ts`) right after
      `rollupBvForPurchase`, same transaction, newly-created path only.
- [x] Tests first, new file `rank.test.ts` (6 tests, all passing):
      `dubaiMonthKey` unit tests including the Dubai-midnight boundary case
      (2026-08-31T20:00:00.000Z UTC = Dubai Sept 1 00:00, must key to
      "2026-09" not "2026-08"); a referral's first purchase AND a later
      reinvestment both add to the sponsor's MRV (no first-purchase gate);
      a referral's OWN downline's purchase does NOT count toward the
      original (grand)sponsor's MRV — only the direct referral's own
      purchases do (built a real 3-level sponsor chain, confirmed the
      2-levels-up grandsponsor's mrv_periods row is null while the direct
      1-level-up sponsor's is correctly populated); MRV resets to 0 in a
      new calendar month (no carry forward — a September purchase and an
      October purchase produce two separate rows, October's volume is NOT
      September's + October's); a purchase by a non-referred root user
      creates zero mrv_periods rows for anyone, including the buyer
      themselves (MRV never self-credits).
- [x] Real gap found and fixed while writing tests (not caught by design
      review): 2 test-authoring bugs, not engine bugs — (1) `Prisma.Decimal
      .toString()` on a whole number returns "1000", not "1000.00000000",
      so string-equality assertions against a padded literal failed; fixed
      by switching to `.equals(...)` per this project's own established
      Decimal-assertion convention (already used in binary-tree.test.ts,
      confirmed via grep before choosing the fix). (2) The month-reset
      test's second (October) purchase reused the same $3000 package
      instead of a cheaper one, but only funded Wallet B with $1500 for
      it — a real insufficient-funds failure, unrelated to MRV logic. Fixed
      by using two distinct packages priced to match each purchase's actual
      funding.
- [x] Real RESTRICT-FK-to-users gap found via the standing SCRUM-70/71
      lesson's own prescribed check (grep every `*.test.ts` for
      `user.deleteMany` before finalizing the schema) — confirmed live by
      actually running the full suite, not just trusting the grep: adding
      `mrv_periods` (FK -> users, RESTRICT) broke 4 pre-existing test
      files' `afterAll` cleanup order, all of which create sponsored users
      who purchase packages (triggering MRV accrual as a side effect) —
      `direct-commission.test.ts`, `users.test.ts`, `binary-cycle.test.ts`
      (2 separate `afterAll` blocks in this file), `bv-rollup.test.ts`.
      Fixed by adding `prisma.mrvPeriod.deleteMany(...)` before
      `user.deleteMany` in all 5 affected blocks across the 4 files —
      identified precisely (not by guessing) via `grep -l
      registerWithSponsor` intersected with `grep -l purchasePackage`
      across every test file, which produced exactly the 4 files that
      actually failed, confirming the method before trusting it further.
- [x] The first full-suite run (before the FK-cleanup fix) left 17 orphaned
      test users behind with dangling mrv_periods rows across the 4 broken
      files. Cleaned up via a scratch script (`.scratch_cleanup_mrv_fk_
      orphans.ts`, deleted after) that derived the exact orphan set from
      `mrv_periods.user_id` (not an email-pattern guess), including a
      leaf-first repeated-delete loop for binary_nodes (self-FK RESTRICT,
      matching the SCRUM-70 precedent for this exact situation) — confirmed
      zero leftover rows in both `mrv_periods` and `users` (by
      `mrv-`/known test-prefix pattern) afterward.
- [x] One transient test timeout observed in the second full-suite run
      (`direct-commission.test.ts`'s forced-mid-commission-failure test,
      20000ms timeout) — re-ran that file alone (21s total, that specific
      test at 1979ms, comfortably under the timeout) and the full suite a
      third time end-to-end, both clean. Per the standing SCRUM-61/79
      lesson ("a clean retry alone doesn't prove a failure was benign"),
      this was treated as requiring a genuine isolated-file re-run as
      evidence, not just a retry of the same full-suite shape — the
      isolated run's normal timing (not just a pass) is what confirms this
      was ordinary system-load contention on a 20s default timeout during a
      41-file×277-test parallel run, not a real regression introduced by
      this change (the change under test never touches
      commission_config or the commission payout path this test exercises).
- [x] `prisma migrate status` clean (28 migrations). `tsc --noEmit` clean
      throughout. Full suite: 39 files, 277/277 passing (271 prior + 6
      new), confirmed via TWO independent clean full runs after the FK fix
      (not just one), plus `reconciliation.test.ts` re-run standalone as
      final proof, 3/3 passing.

Schema + accrual only — the monthly rank-evaluation job that reads
mrv_periods against rank_config and grants ranks is `rank_awards`' own
upcoming ticket, per Zac's explicit request to review each piece
incrementally.

## SCRUM-85: rank_awards table + rank evaluation/grant logic — DONE

- [x] Added `RankAward` model (userId FK -> users RESTRICT, rank text,
      achievedMonth text, rewardAmount/rewardType SNAPSHOTTED from the
      rank_config row active at grant time — never a live FK read, so a
      later admin edit to rank_config can't retroactively change an
      already-granted award's value, per invariant #6 — rewardChoice
      nullable for Partner's later cash-or-trip choice, creditedAt nullable
      for the later Friday-payout-sweep ticket, idempotencyKey unique text
      `rank_reward:{user_id}:{rank}`, UNIQUE(userId, rank) enforcing
      once-ever at the DB level). Migration `20260822150000_add_rank_awards`
      + `migrate deploy` + `prisma generate`.
- [x] **Real design gap found while writing tests, confirmed with Zac before
      fixing** (not silently patched): the phase brief's own "repeating the
      same qualifying performance in a later month grants nothing" test
      case exposed that "highest newly-qualified, skip already-awarded
      ranks" alone was insufficient — a LOWER rank crossed the same month
      as a granted higher rank (e.g. Investor crossed alongside Partner,
      but never itself recorded anywhere since only Partner got a
      rank_awards row) would incorrectly become claimable again in a LATER
      month where the same performance merely repeats, effectively paying
      the lower rank late and contradicting "only the highest is paid."
      Asked Zac directly: should a forfeited lower rank remain claimable in
      a future month, or be permanently forfeited the moment a higher rank
      wins? **Answer: permanently forfeited.** Confirmed the fix
      (a dedicated `RankForfeit` table, not conflating forfeits into
      rank_awards) as the cleaner of two options before building it.
- [x] Added `RankForfeit` model (userId FK -> users RESTRICT, rank,
      forfeitMonth, UNIQUE(userId, rank) — same once-ever permanence
      reasoning as RankAward, but deliberately a SEPARATE table so
      rank_awards stays a clean audit trail of real, rewarded grants only).
      Migration `20260822160000_add_rank_forfeits` + `migrate deploy` +
      `prisma generate`.
- [x] `src/lib/rank.ts`: `qualifiedDirectReferralCount(userId)` — live,
      uncached count of sponsor-tree direct referrals (`sponsorId: userId`,
      depth 1) holding an ACTIVE investment and not suspended, explicitly
      mirroring `isLegActive`'s "pure live read, no caching" reasoning
      (never drifts out of sync with capital-release/suspension events).
      `evaluateRankForUser(userId, month, forDate)`: requires the user's
      own active investment; loads that month's mrv_periods volume
      (0 if none); queries active rank_config rows ordered rankOrder desc;
      excludes ranks already in rank_awards OR rank_forfeits for this user
      (either one is a permanent "already decided" signal); finds every
      newly-qualified rank (MRV + referral thresholds both met); grants
      only the first (highest) as a real RankAward, records every other
      newly-qualified rank in that same call as a RankForfeit. Per-user
      engine function (mirrors closeBinaryCycleForUser's shape) — the
      batch/job wrapper iterating every user with job_runs catch-up
      tracking is `rank-job.ts`'s own later ticket, not built here. Grants
      only, never touches the ledger — the reward is snapshotted with
      `creditedAt: null`; the weekly Friday payout sweep that actually
      credits Wallet C is a separate later ticket, per mlm_rules_log's
      "granted immediately, reward credited on the next Friday cycle."
- [x] Tests first, extended `rank.test.ts` (6 new tests, all passing): the
      exit-test scenario itself (4 qualified referrals + 100,000 MRV in one
      month -> Partner granted immediately, reward snapshotted at $2,000/
      CASH_OR_TRIP, creditedAt null, correct idempotencyKey); crossing
      multiple thresholds in one month grants only the highest (Partner),
      with Investor recorded as a real RankForfeit (not just absent) for
      that same month; repeating the same qualifying performance in a
      later month grants nothing — Partner already awarded, Investor
      already forfeited, both permanently excluded; meeting only MRV (not
      referral count) grants nothing; meeting only referral count (not
      MRV) grants nothing; the user's own active investment is required
      even with both other thresholds met.
- [x] `prisma migrate status` clean (30 migrations). `tsc --noEmit` clean
      throughout. Full suite: 39 files, 283/283 passing (277 prior + 6
      new), confirmed via a clean full run, plus `reconciliation.test.ts`
      re-run standalone as final proof, 3/3 passing. No new RESTRICT-FK
      cleanup-order gaps this time (grep-confirmed: rank_awards/
      rank_forfeits are currently only ever written by
      `evaluateRankForUser`, which only `rank.test.ts` calls, so no
      pre-existing test file's `afterAll` could be broken by this change
      — unlike SCRUM-84's mrv_periods, which purchasePackage writes to
      unconditionally).

Grant/evaluation logic only — the monthly batch job (job_runs catch-up,
iterating every user), the weekly Friday payout sweep (actually crediting
Wallet C), admin rank CRUD, and the Partner cash-vs-trip choice action are
each their own upcoming tickets, per Zac's explicit request to review each
piece incrementally.

## SCRUM-86: reward payout mechanism — DONE

No schema change needed — `RankAward.creditedAt`/`rewardChoice` were
already designed in SCRUM-85 specifically for this ticket's "queued vs.
settled" state, so this ticket is pure `src/lib/rank.ts` logic, no
migration.

- [x] `payQueuedRankRewards(forDate): Promise<{ paid, stillQueued }>`:
      sweeps every `RankAward` with `creditedAt: null`. CASH (or
      CASH_OR_TRIP with `rewardChoice: "CASH"`) credits Wallet C via
      `postTransaction` (CREDIT user / DEBIT SYSTEM_EXTERNAL, matching
      Binary Commission's "new money, not a transfer" shape — fully
      available, no saving split, per mlm_rules_log's explicit "no 3-month
      saving split unlike Direct Commission's 3%"), then stamps
      `creditedAt`. CASH_OR_TRIP with `rewardChoice: "TRIP"` stamps
      `creditedAt` directly with NO ledger call at all — a genuinely
      logged-only award. CASH_OR_TRIP with `rewardChoice: null` (no choice
      made yet) is left completely untouched — never defaults to either
      option, stays queued indefinitely until a real choice is recorded.
      Idempotent per award via the award's own already-stored
      `idempotencyKey` (`rank_reward:{user_id}:{rank}`) — `postTransaction`'s
      own replay guard plus this function only ever selecting still-queued
      (`creditedAt: null`) rows means a second sweep can't double-pay or
      re-touch an already-settled award. A per-call batch sweep (not a
      per-user engine function like `evaluateRankForUser`) — deliberately
      NOT gated on "is forDate a Friday" internally; cadence is the
      caller's/scheduler's job (mirrors how binary-cycle-job.ts's cron
      trigger, not the engine function, owns day-of-week gating), so the
      function is safe to call any day and simply no-ops if nothing is due.
- [x] Tests first, extended `rank.test.ts` (5 new tests, all passing): a
      rank granted mid-week has no ledger entry until the sweep actually
      runs (grant and payout are genuinely decoupled — proven by asserting
      the specific award's own ledger scope, not by waiting for a real
      calendar week to pass); a CASH reward pays exactly the config
      -snapshotted amount (a real per-user active-investment referral chain
      generates real Direct Commission side-effects on the sponsor's Wallet
      C too, so assertions are scoped to the reward's own idempotencyKey
      /ledger entries, never a raw absolute wallet balance — see the real
      gap below); idempotent replay writes no second ledger entry; a
      CASH_OR_TRIP award with CASH chosen pays correctly; a CASH_OR_TRIP
      award with TRIP chosen creates zero ledger entries but is marked
      settled (`creditedAt` set); a CASH_OR_TRIP award with no choice made
      yet stays queued past a sweep — never defaulting — and later pays
      correctly once the choice is actually recorded, proving it was
      genuinely queued rather than silently dropped.
- [x] Real test-design gap found and fixed while writing tests (not an
      engine bug): early drafts asserted Wallet C balance equals exactly 0
      before payout and exactly the reward amount after. This is wrong in
      this project's real system — every referral built via the test's own
      `giveActiveInvestment` helper triggers real Direct Commission (5%) on
      ITS FIRST purchase, crediting the SAME sponsor's Wallet C as a
      genuine, unrelated side effect before the rank reward is ever
      evaluated. An exact-balance assertion silently assumed a pristine
      wallet that never actually exists once a sponsor has real qualified
      referrals (which every one of these tests requires, by construction).
      Fixed by scoping every payout assertion to the reward's own
      `idempotencyKey`/ledger-entry set (which `postTransaction`'s replay
      guard already keys uniquely per award) instead of an absolute wallet
      balance — the same "don't assume pristine shared state" discipline
      as the pre-existing `payQueuedRankRewards` global-sweep-count
      assertions below, just for wallet balances instead of row counts.
- [x] Second real test-design gap, same root class: `payQueuedRankRewards`
      has no per-user scope by design (a real Friday sweep must process
      every currently-queued award in the DB) — so `summary.paid`/
      `stillQueued` exact-equality assertions (`toBe(1)`) are vulnerable to
      other tests' queued/unswept awards riding along in the same shared
      -dev-DB call within one file run. Fixed by asserting
      `toBeGreaterThanOrEqual(...)` on the sweep's own summary counts, and
      always independently verifying the SPECIFIC award under test via a
      direct `rankAward`/`ledgerEntry` query scoped to that award's own id/
      idempotencyKey — the sweep's aggregate numbers are treated as
      "at least what I expect," never "exactly," while the one award this
      test actually owns is checked precisely.
- [x] `tsc --noEmit` clean throughout. Full suite: 39 files, 288/288
      passing (283 prior + 5 new), confirmed via a clean full run, plus
      `reconciliation.test.ts` re-run standalone as final proof, 3/3
      passing — confirms the rank-reward ledger writes are genuinely
      balanced (CREDIT user / DEBIT SYSTEM_EXTERNAL) with zero drift.

No new RESTRICT-FK cleanup-order gaps and no new migration this ticket —
`payQueuedRankRewards` only writes to `rank_awards` (already cleaned up in
this file's `afterAll` since SCRUM-85) and `ledger_entries` (already
covered by `cleanupLedgerEntriesForUsers`).

## SCRUM-87: admin rank CRUD — DONE

Small schema change confirmed with Zac before building: `admin_actions` has
no `targetRankConfigId` FK (unlike `targetPackageId` for packages) — added
2 new `AdminActionType` enum values (`RANK_CONFIG_CREATED`,
`RANK_CONFIG_EDITED`) via a small migration rather than a new FK column,
logging the rank name/new values into the existing nullable `reason` text
field (same posture as how `admin_actions.reason` already carries free
-text context elsewhere).

- [x] Migration `20260822170000_add_rank_config_admin_actions`
      (`ALTER TYPE ... ADD VALUE`, mirrors the exact
      `USER_SUSPENDED`/`USER_REINSTATED` precedent) + `migrate deploy` +
      `prisma generate`.
- [x] `src/lib/rank.ts`: `assertHasRankConfigPermission(actingAdminId)`
      (mirrors `assertHasUserManagementPermission`/
      `requirePackageManagement`'s exact shape — main admin bypasses,
      sub-admin needs the explicit `RANK_CONFIG` grant).
      `editRankConfig(actingAdminId, { rankName, mrvRequired?,
      directReferralsRequired?, rewardAmount?, rewardType?, forDate })`:
      finds the current active row for that `rankName`, closes it
      (`effectiveTo: forDate`), inserts a new active row carrying over
      every unspecified field from the closed row (same `rankOrder` —
      changing a rank's position isn't this function's job). NEVER
      mutates the existing row in place — this is what makes the critical
      "no retroactive effect" invariant hold automatically: every
      money-relevant reader (`evaluateRankForUser` reads `effectiveTo:
      null` only; `payQueuedRankRewards` reads `RankAward`'s own
      grant-time snapshot, never rank_config) simply never revisits a
      closed historical row.
      `createRankConfig(actingAdminId, { rankName, mrvRequired,
      directReferralsRequired, rewardAmount, rewardType, rankOrder,
      forDate })`: plain insert of a new active row (no prior row to
      close) — used both for genuinely new ranks (e.g. adding one above
      OG) and relies on the DB's `rank_config_one_active_per_rank` partial
      unique index as the backstop against colliding with an
      already-active rank of the same name, matching this codebase's
      existing "trust the constraint" posture elsewhere. Both log to
      `admin_actions` (`RANK_CONFIG_EDITED`/`RANK_CONFIG_CREATED`) with
      the new values in `reason`.
- [x] Tests first, extended `rank.test.ts` (5 new tests, all passing):
      editing a rank's threshold takes effect for future evaluations only
      — proven two ways in one test: the OLD row survives closed-but-
      intact (not deleted/mutated) with its original values, and a
      DIFFERENT user evaluated AFTER the edit under the NEW threshold no
      longer qualifies where the old threshold would have let them;
      an already-granted award's snapshotted `rewardAmount` is unaffected
      by a later edit — proven by both reading the award row directly
      (unchanged $500 after editing the rank's reward to $999,999) AND by
      actually running `payQueuedRankRewards` and confirming the real
      ledger credit is still the OLD $500, not the new value; an admin
      without RANK_CONFIG is rejected for both edit and create; a
      sub-admin WITH the RANK_CONFIG grant is allowed, and the
      `admin_actions` audit row is confirmed written; a new rank ("Legend",
      above OG's rankOrder) can be created and is immediately evaluable —
      proven by actually running `evaluateRankForUser` against a real user
      who only meets the new rank's own modest thresholds and confirming
      it grants "Legend," not just that the config row exists.
- [x] Real cleanup-order gap found and fixed (a new instance of the
      standing RESTRICT-FK lesson, this time via `admin_permission_grants`
      rather than a table introduced this session): the new "sub-admin
      WITH the grant" test creates a real `AdminPermissionGrant` row for
      RANK_CONFIG; `rank.test.ts`'s `afterAll` had no
      `adminPermissionGrant.deleteMany` before `user.deleteMany`, so the
      grant's own FK to `users` blocked deletion — caught by actually
      running the full test file, not just the individual test passing.
      Fixed by adding `adminPermissionGrant.deleteMany({ where: {
      adminUserId: { in: createdUserIds } } })` (and, while auditing the
      same failure, `adminAction.deleteMany({ where: { adminId: { in:
      createdUserIds } } })` for the sub-admin-as-actor rows these new
      tests also create) before `user.deleteMany`. The first run's failed
      cleanup left 69 orphaned test users behind (everything upstream of
      `user.deleteMany` in that `afterAll` had already succeeded, so no
      `mrv_periods`/`rank_awards`/ledger rows were orphaned — only the
      users themselves plus 1 leftover `admin_permission_grants` row);
      cleaned up via a scratch script deriving the exact scope from the
      `mrv-` email prefix, deleted after; re-ran the file in isolation
      afterward with zero leftover rows as proof.
- [x] Manually verified the real seeded `rank_config` data survived every
      edit/restore cycle in these tests intact: a direct `psql` query
      after the full suite confirmed all 8 real ranks still have their
      exact original seed values (Investor 25,000/2/$500 CASH ... OG
      100,000,000/20/$2,000,000 CASH) and `effective_to IS NULL` — the
      `finally`-block restoration pattern (mirroring
      `binary-cycle-close.test.ts`'s own historical-rate-config test
      precedent: close the real row, test against a substitute, restore
      the real row's `effective_to` back to null in `finally`) left no
      trace on the shared dev DB's real config.
- [x] `prisma migrate status` clean (31 migrations). `tsc --noEmit` clean
      throughout. Full suite: 39 files, 293/293 passing (288 prior + 5
      new), confirmed via a clean full run, plus `reconciliation.test.ts`
      re-run standalone as final proof, 3/3 passing.

Admin CRUD only — this exposes `editRankConfig`/`createRankConfig` as
callable library functions with the correct permission/versioning
semantics; wiring an actual admin-panel UI/server-action route for them is
Phase 10/11 territory, not part of this ticket's scope.

## SCRUM-88: Partner choice action + two job wrappers + worker cron — DONE

Two design questions confirmed with Zac before building (both touched
architectural judgment, not just implementation detail):
1. Monthly evaluation job's user scope — confirmed: scope to users with an
   `mrv_periods` row for the specific month being evaluated (a user with
   zero MRV that month can never meet even Investor's 25,000, so scanning
   the full users table every month would be pure waste).
2. Monthly evaluation cron trigger — confirmed: 00:10 Asia/Dubai on the 1st
   of each month (just after the month closes, offset from the daily
   interest job's 00:05 to reduce midnight contention).

- [x] `src/lib/rank.ts`: `chooseRankReward(userId, rank, choice)` — a user
      records their own CASH/TRIP choice on a pending CASH_OR_TRIP award.
      Ownership enforced by construction (`userId` is the only lookup
      filter, invariant #9 — a user with no award of their own for `rank`
      gets the same error as "never granted," never a leak about another
      user's award). Rejects: no award exists for this user+rank; the
      award's `rewardType` isn't CASH_OR_TRIP (nothing to choose for a
      plain-CASH rank); a choice was already made (permanent once set,
      never silently overwritten). Does not touch `creditedAt`/the ledger
      — only `payQueuedRankRewards` (SCRUM-86) actually settles based on
      whatever choice ends up recorded here.
- [x] `src/lib/rank-evaluation-job.ts`: `runRankEvaluationCatchUp(today)` +
      `RANK_EVALUATION_JOB_TYPE = "rank_evaluation"`. Mirrors
      binary-cycle-job.ts's exact shape, stepping by calendar months
      (period_key = "YYYY-MM") instead of weeks: `unprocessedMonths`
      walks from the last COMPLETED month (exclusive) through the most
      recently closeable month (the month before `today`'s own current
      month — a month isn't closeable until it has fully ended) —
      first-ever run only processes the single most recently closeable
      month, never a backward walk to an epoch (standing SCRUM-52 rule).
      `runOneMonth` scopes to every DISTINCT `userId` with an `mrv_periods`
      row for that month, calls `evaluateRankForUser` per user, tracked in
      `job_runs` RUNNING -> COMPLETED/FAILED exactly like
      `runBinaryCycleCatchUp`'s per-week loop.
- [x] `src/lib/rank-payout-job.ts`: `runRankPayoutCatchUp(today)` +
      `RANK_PAYOUT_JOB_TYPE = "rank_payout"`. Same binary-cycle-job.ts
      shape again, but weekly (reuses `saturdayWeekStart` from
      binary-cycle.ts directly — the SAME Saturday-to-Friday cycle
      boundary as binary commission, since a rank reward is also
      "credited on the next Friday cycle"). Each unprocessed week simply
      calls `payQueuedRankRewards(weekStart)` once — unlike the binary/
      evaluation jobs, there's no per-user loop here, since the payout
      sweep itself has no per-user scope by design (SCRUM-86: it pays
      every currently-queued award in one pass, from any prior grant
      month).
- [x] `src/worker/index.ts`: wired both new cron triggers —
      `10 0 1 * *` (00:10 Asia/Dubai, 1st of month) for rank evaluation,
      `0 0 * * 6` (Saturday 00:00 Asia/Dubai, same as the binary cycle
      job) for rank payout. Both wrapped in try/catch + console logging,
      matching the existing two jobs' exact error-handling shape.
- [x] Tests first: `rank.test.ts` extended with a `chooseRankReward`
      describe block (6 tests — records CASH, records TRIP, rejects an
      already-made choice without overwriting it, rejects a non-CASH_OR_TRIP
      award, rejects a never-granted rank, ownership check that one user
      cannot touch another's award). New `rank-evaluation-job.test.ts`
      (5 tests, mirrors binary-cycle-job.test.ts's structure including
      the `vi.spyOn` failure-injection pattern via a module-namespace
      import): multi-month gap catch-up in order; no reprocessing of an
      already-COMPLETED month; true-first-run processes only the most
      recently closeable month; a mid-loop failure marks FAILED (not
      COMPLETED) and a retry recovers and completes; a user with zero MRV
      that month is skipped entirely. New `rank-payout-job.test.ts`
      (4 tests, same shape stepping by weeks): multi-week catch-up paying
      the correct closed week's queued awards for real (real ledger
      credit confirmed, not just a job_runs row); no reprocessing of an
      already-COMPLETED week; true-first-run processes only the most
      recently closeable week; a mid-loop failure marks FAILED and a
      retry completes and pays the still-queued award for real.
- [x] Real test-design gap found and fixed while writing the job tests
      (not an engine bug): the first draft of `rank-evaluation-job.test.ts`
      had no `afterEach` clearing `job_runs` rows between tests within the
      same file run — `binary-cycle-job.test.ts` (the file being mirrored)
      already has exactly this pattern and it was initially missed when
      copying the shape. Without it, later tests inherited earlier tests'
      `COMPLETED` `job_runs` rows for the same `jobType`, breaking: the
      "first-ever run" test's own `priorCount === 0` precondition; the
      "does not reprocess" test's award (a NEW user's month appeared
      already-COMPLETED from an earlier test, so it was silently never
      evaluated at all — `runOneMonth` returns early without touching any
      user when a period is already COMPLETED); and the failure-injection
      test (the month it targeted was already COMPLETED, so the spy never
      got a chance to intercept a real evaluation, and the call
      short-circuited to a silent success instead of the expected
      rejection). All three failures traced to the exact same root cause,
      confirmed by adding the missing `afterEach` (`vi.restoreAllMocks()`
      + `jobRun.deleteMany` scoped to `createdJobRunPeriodKeys`,
      identical to binary-cycle-job.test.ts) — all 5 tests passed
      immediately after, with zero other changes needed.
- [x] `tsc --noEmit` clean throughout. Full suite: 41 files, 308/308
      passing (293 prior + 15 new), confirmed via a clean full run, plus
      `reconciliation.test.ts` re-run standalone as final proof, 3/3
      passing.
- [x] **Live verification in the running dev environment, not just unit
      tests** (explicitly required by this ticket): `docker compose
      restart worker` to pick up the new cron registrations, then
      `docker compose logs worker --tail 30` — confirmed the two new
      startup log lines actually printed on a real restart:
      `[worker] rank evaluation job scheduled for 00:10 on the 1st of
      each month Asia/Dubai` and `[worker] rank payout job scheduled for
      Saturday 00:00 Asia/Dubai`, alongside the two pre-existing jobs'
      own lines. Cross-checked this wasn't a stale/cached process by
      `docker compose exec worker grep`-ing the live container's own
      `src/worker/index.ts` for both new log strings (found, count 2) —
      confirms the bind-mounted file the running container is executing
      genuinely has this session's changes, not an old cached build.
      `docker compose ps worker` confirmed the container stayed up (no
      crash loop) 30+ seconds after the restart.

Both jobs, the choice action, and the worker wiring are all in place.
Everything from the phase brief's own required pieces is now built:
rank_config (SCRUM-83), MRV accrual (SCRUM-84), evaluation/grant
(SCRUM-85), payout engine (SCRUM-86), admin CRUD (SCRUM-87), and the
choice action + batch job wrappers + cron (SCRUM-88, this ticket). The
phase brief's own exit test has not yet been run end-to-end against the
real dev DB as a single scripted scenario — that's the natural last step
before declaring Phase 9 complete.

## SCRUM-89: Phase 9 exit test — RUN AND PASSED

Ran a real scratch script (`.scratch_exit_test_phase9.ts`, deleted after —
matches the Phase 3/5/6/7/8 exit-test convention) directly against the dev
database, using real lib functions (`registerAsRoot`/`registerWithSponsor`,
`adminCreditWalletB`, `purchasePackage`, `evaluateRankForUser`,
`chooseRankReward`, `payQueuedRankRewards`) as one continuous end-to-end
scenario — not a re-run of the permanent unit suite. Migration state
verified clean first (`prisma migrate status`); confirmed no other Node
process was running before starting, per the standing SCRUM-79/81
concurrency lesson.

### Results (28/28 assertions passed)

**Scenario 1 — Partner granted immediately, Investor NOT also paid:**
- Sponsor + 4 qualified referrals, each buying a real $25,000 package
  (4 x $25,000 = $100,000 real accrued MRV, confirmed by direct
  `mrv_periods` query — not seeded) -> `evaluateRankForUser` grants
  Partner (not Investor), snapshotted at $2,000 CASH_OR_TRIP,
  `creditedAt: null` immediately after grant (queued, not auto-paid)
- Investor's threshold (25,000/2) was also genuinely crossed that month
  but has NO real `rank_awards` row — instead a real `rank_forfeits` row
  exists, stamped to September, proving the "only highest is paid" rule
  is enforced as a permanent decision, not just an absent side effect

**Scenario 2 — CASH choice credited on the next Friday cycle:**
- `chooseRankReward(sponsor, "Partner", "CASH")` recorded for real
- `payQueuedRankRewards` on a real Friday date credits exactly $2,000 to
  Wallet C — confirmed via the real ledger entries (CREDIT user / DEBIT
  SYSTEM_EXTERNAL, entryType RANK_REWARD) AND via the real measured
  Wallet C balance delta ($2,000 exactly), not just the job's own summary
  count

**Scenario 3 — repeating the same performance next month pays nothing:**
- Same sponsor, 4 more referrals, another real $100,000 of October MRV
  purchased for real -> `evaluateRankForUser` for October grants NOTHING
  (`granted: false`)
- Still exactly 1 Partner award ever (no duplicate)
- Investor is STILL not granted in October — proves the September
  forfeit is genuinely permanent (per the SCRUM-85 design decision),
  not merely a one-time skip that a repeat performance could bypass

**Scenario 4 — TRIP choice is logged-only, no ledger credit:**
- A second, independent sponsor also granted Partner for real
- `chooseRankReward(tripSponsor, "Partner", "TRIP")` recorded
- After the Friday sweep: `creditedAt` is set (marked settled) but ZERO
  ledger entries exist under that award's idempotency key, and the
  sponsor's Wallet C balance is measured completely unchanged —
  confirms "logged-only, no money moved" for real, not just by absence
  of an assertion

### Real script bug found and fixed (not an engine bug)
First draft's referral purchases inflated MRV to $400,400 (then $400,000
after a partial fix) instead of the intended $100,000 — caused by
purchasing BOTH a $100,000 Elite package per referral AND calling the
test's own `giveActiveInvestment` helper (an extra $100 purchase) for
each, when a single purchase per referral already satisfies both "holds
an active investment" (qualification) and the real MRV-accruing event.
Root-caused by reading the actual accrued `mrv_periods.volume` after the
first failure rather than guessing, then fixed by using one real $25,000
purchase per referral (4 x $25,000 = exactly $100,000) with no redundant
second purchase.

### Cleanup and regression check
- Script's own cleanup used the same ordered deletion pattern as prior
  phase exit tests (`rankForfeit` -> `rankAward` -> `mrvPeriod` ->
  `savingLot` -> `bvEntry` -> `investment` -> `cleanupLedgerEntriesForUsers`
  -> `package` -> `securityQuestion` -> `walletAccount` -> `binaryNode` ->
  `user`) — reported "Cleaned up 14 users, 3 packages, 14 investments."
- Verified zero leftover `phase9exit-*` users and zero orphaned
  `rank_awards`/`rank_forfeits`/`mrv_periods` rows via a separate direct
  query, before even getting to the full-suite pass.
- Scratch script deleted; `git status` confirms no trace.
- Full suite: 41 files, 308/308 passing (same count as SCRUM-88 — an
  exit-test scratch script, not a permanent test file, so no new test
  count). `tsc --noEmit` clean.
- `reconciliation.test.ts` (the whole-database solvency check) explicitly
  re-run standalone as the final step, per the standing rule — 3/3
  passing on its own, not just bundled into the full-run count. Confirms
  the rank-reward ledger writes across all 4 scenarios stayed genuinely
  balanced with zero drift.

**PHASE 9 EXIT TEST: ALL 4 SCENARIOS / 28 ASSERTIONS PASSED. Full suite
clean, including standalone whole-database reconciliation.**

Phase 9 is complete pending user confirmation in the operation-room chat
per CLAUDE.md's build-order rule.

# Phase 8 — Binary Cycle Engine

## SCRUM-82: Phase 8 exit test — RUN AND PASSED

Ran a real scratch script (`.scratch_exit_test_phase8.ts`, deleted after —
matches the Phase 3/5/6/7 exit-test convention) directly against the dev
database, using real lib functions (`registerAsRoot`/`registerWithSponsor`,
`adminCreditWalletB`, `purchasePackage`, `closeBinaryCycleForUser`), not a
re-run of the permanent unit suite. Migration state verified clean first
(`prisma migrate status`); confirmed no other Node process was running
before starting, per the standing SCRUM-79/81 concurrency lesson.

### Results (25/25 assertions passed)

**Scenario 1 — the spec's exact worked example (Left 15,000 / Right
7,000 -> 560 commission, next cycle opens 8,000/0):**
- Sponsor qualifies (active investment + both legs active)
- leftVolume=15000, rightVolume=7000, matched=min(15000,7000)=7000
- commission = 8% x 7000 = 560, exactly — both on the `binary_cycles`
  row AND confirmed as a real ledger CREDIT to the sponsor's Wallet C
- Next cycle opens carryLeft=8000, carryRight=0

**Scenario 2 — unqualified user accrues carry, paid nothing:**
- Sponsor with an inactive RIGHT leg: qualified=false,
  qualificationReason="right_leg_inactive"
- matched=0, commission=0, zero ledger entries written
- Full 4,200 BV still carries forward in full (nothing lost)

**Scenario 3a — a carry unmatched past the expiry window is dropped:**
- Seeded a prior cycle with a 9,000 carry-in whose age (7 months) exceeds
  the real seeded 6-month `binaryCarryForwardExpiryMonths`
- Confirmed the stale 9,000 was dropped: this cycle's leftVolume = only
  the fresh 600 BV, not 9,600 — matched on the fresh volume only

**Scenario 3b — a carry that matches before expiry resets its age
counter:**
- Cycle A: Left/Right both 2,000, fully matches -> carryLeft resets to 0,
  carryLeftSince resets to null
- Cycle B: a brand-new unmatched Left-only carry of 3,000 starts ->
  carryLeftSince is freshly stamped to cycle B's own week_start, NOT
  inherited from any age that existed before cycle A's full match —
  proves the age genuinely resets, not just "happens to be recent"

**Scenario 4 — re-running an already-processed week creates no
duplicate payout:**
- Replayed `closeBinaryCycleForUser` for scenario 1's exact (user, week)
  a second time: returns the identical `binary_cycles` row (same id),
  identical commissionPaid
- Exactly one `binary_cycles` row and exactly one ledger CREDIT entry
  exist for that (user, week) after the replay — no duplicate row, no
  double-payout

### Cleanup and regression check
- Script's own cleanup used `cleanupLedgerEntriesForUsers`
  (idempotencyKey-scoped, SYSTEM_EXTERNAL-safe) + FK-safe deletion order
  (binary_cycles -> bv_entries -> investments -> ledger -> packages ->
  security_questions -> wallet_accounts -> binary_nodes -> users) —
  reported "Cleaned up 12 users, 12 packages, 12 investments."
- Verified zero leftover `phase8exit-*` users and zero orphaned
  `binary_cycles` rows in the DB after the script's own cleanup ran, via
  a separate scratch check, before even getting to the full-suite pass.
- Scratch script deleted; `git status` confirms no trace.
- Full suite: 38 files, 271/271 passing (run in isolation, no concurrent
  Node processes). `tsc --noEmit` clean.
- `reconciliation.test.ts` (the whole-database solvency check) explicitly
  re-run standalone as the final step, per the standing rule — 3/3
  passing on its own, not just bundled into the full-run count.

**PHASE 8 EXIT TEST: ALL 4 SCENARIOS / 25 ASSERTIONS PASSED. Full suite
clean, including standalone whole-database reconciliation.**

Phase 8 is complete pending user confirmation in the operation-room chat
per CLAUDE.md's build-order rule.

## SCRUM-81: binary panel UI — DONE

Placement decision: extended the existing `/binary-tree` page with a new
section above the tree (not a separate route) — same feature area, and
the page already had a multi-section layout pattern (header + sections)
established by SCRUM-73 and the referrals page.

- [x] `src/lib/binary-cycle.ts`: added `getMyLatestBinaryCycle(userId)` —
      most recent `binary_cycles` row (`orderBy: { weekStart: "desc" }`),
      ownership by construction (invariant #9). Returns null for zero
      cycle history. Also added `daysUntilNextSaturday(now)`, mirroring
      `daysUntilNextFriday`'s exact convention (0 = today, no negative
      countdown), reusing the existing `weekdayShort`/`SATURDAY` helpers
      already in the file rather than duplicating them elsewhere.
- [x] `src/app/[locale]/binary-tree/page.tsx`: fetches the latest cycle
      alongside the subtree via `Promise.all`, renders a new `cycleHeading`
      section above the tree section using `BinaryPanel`.
- [x] `binary-panel.tsx` (new client component):
      - Left/right volume bars: hand-built div-based bars (no Progress
        component existed in this project), proportional to the larger of
        the two.
      - Carry-forward shown as its own explicit labeled value
        (carryLeft/carryRight), not attempting to back out "fresh this
        week" separately from leftVolume/rightVolume (which already
        include carry-in per the schema).
      - Qualification: emerald badge (matches this project's existing
        success-state color, confirmed via grep of
        capital-release-panel.tsx et al. — no separate design system
        deviation) for qualified; amber badge (new to this project, no
        prior precedent, but a reasonable minimal Tailwind-standard
        addition for "not qualified" since `destructive` red was too harsh
        for an ordinary weekly outcome) for unqualified, plus the specific
        translated qualificationReason sentence below it.
      - Countdown via `daysUntilNextSaturday`.
      - No-history empty state (History icon + explanatory copy) when
        `getMyLatestBinaryCycle` returns null.
      - Imports `QualificationFailureReason` from `@/lib/binary-cycle`
        directly rather than redeclaring a duplicate union type in the
        client component.
- [x] i18n: new keys added under the existing `BinaryTree` namespace (not
      a separate nested object — matches the page's existing flat-keys
      -under-one-namespace convention) in both messages/en.json and
      messages/ar.json in this commit, including one translated sentence
      per qualificationReason value. "LEFT"/"RIGHT"/"Binary Commission"
      stay English per the glossary in both locales (verified live in the
      Arabic render).
- [x] RTL pass: grepped all new/changed binary-tree files for physical
      left-*/right-*/ml-*/mr-*/pl-*/pr-*/text-left/text-right — zero
      matches. Volume bars use plain block-level width (no absolute
      positioning), so they flip correctly under `dir="rtl"` automatically
      without needing explicit RTL-specific classes.
- [x] `loading.tsx` updated with a skeleton for the new panel section.
- [x] `tsc --noEmit` clean throughout (one real type gap found and fixed:
      the DB's `qualification_reason` column is a plain nullable string,
      not a Postgres enum, so `latestCycle.qualificationReason` types as
      `string | null` from Prisma — narrowed at the page.tsx boundary via
      an explicit, commented cast to `QualificationFailureReason | null`,
      justified because only `closeBinaryCycleForUser`'s own union ever
      writes that column).
- [x] Full suite: 38 files, 271/271 passing (same count as SCRUM-80, no
      new automated tests added — a UI-only ticket), including
      `reconciliation.test.ts` clean. Confirmed via a single isolated run.
- [x] Manual verification in the running dev container (not just unit
      tests): `docker compose restart app` picked up the new component
      with no compile errors. Built three real scenarios via a scratch
      script run inside the app container against the real dev DB
      (qualified sponsor: 5000/5000 BV, real `closeBinaryCycleForUser`
      call → matched 5000, commission 400 at the seeded 8% rate;
      unqualified sponsor: `right_leg_inactive`; fresh root with zero
      cycle history), logged each in via the real `login()` function, and
      fetched `/en/binary-tree` and `/ar/binary-tree` with real session
      cookies via curl. Confirmed real serialized values in the response
      (5000.00/400.00 for the qualified case, the raw `right_leg_inactive`
      reason key for the unqualified case, the no-history empty-state copy
      for the fresh root) and confirmed `dir="rtl"` plus the translated
      "مؤهل" (Qualified) string render correctly in `/ar`, with "Binary
      Commission" staying English.
- [x] Hit and resolved a real environment hazard mid-verification (logged
      in lessons.md as a generalization of the SCRUM-79 rule): the first
      verification pass ran the scratch script while a background
      full-suite `vitest run` was STILL executing against the same shared
      dev DB — produced 4 unexplained `binary_cycles` rows for a user the
      script only closed one cycle for, and a false "unqualified" reading.
      Also found and fixed, independent of the concurrency issue, a real
      script bug: the "qualified" scenario funded/purchased for the two
      children but never gave the SPONSOR their own active investment
      (qualification requires the sponsor's own active investment, not
      just both legs active). Fully cleaned up the contaminated data,
      waited for the background suite to actually finish, then re-ran the
      identical script in true isolation — reproduced exactly one clean
      row per user with the correct qualified/commission numbers,
      confirming the concurrency theory without needing to trace the
      exact foreign write path (which was no longer inspectable after the
      fact). All verification data (users, sessions, investments,
      binary_cycles, packages) cleaned up afterward via a scratch cleanup
      script; confirmed zero leftover `scrum81verify-*` users. Both
      scratch scripts deleted; `git status` confirms no trace.

## SCRUM-80: weekly binary cycle batch job — DONE

Confirmed with user before implementing: batch scope is users with a
`binary_nodes` row (ever placed in the tree), not every `User` row —
avoids permanent all-zero binary_cycles noise for pure admins/never
-placed users while still covering everyone who could ever qualify.

Design (mirrors daily-interest-job.ts's split exactly):
- `unprocessedWeeks(today)`: finds the last COMPLETED job_runs row for
  job_type `binary_cycle`, walks forward WEEK BY WEEK (period_key =
  week_start ISO date) from the week after that, through the most
  recently CLOSEABLE week relative to `today` — i.e. `saturdayWeekStart
  (today) - 7 days` (a week isn't closeable until its own Friday 23:59
  has passed; if `today` itself is Saturday 00:00, that's exactly the
  week that just ended).
- First-ever run (no prior COMPLETED row): per the standing SCRUM-52
  lesson ("a job that never ran before was never 'missed' for any prior
  week — there's no history to catch up on"), only the most recently
  closeable week is due, never walking back to an arbitrary epoch.
- `runOneWeek(weekStart)`: job_runs upsert RUNNING -> iterate every user
  with a binary_nodes row (`prisma.binaryNode.findMany({ select: {
  userId: true } })`) -> `closeBinaryCycleForUser(userId, weekStart,
  weekEnd)` for each -> COMPLETED/FAILED, matching runOnePeriod's
  try/catch/error-message shape exactly.
- `runBinaryCycleCatchUp(today)`: public entry, mirrors
  runDailyInterestCatchUp — takes `today` as a parameter (invariant #4),
  processes unprocessed weeks oldest-first.
- Worker (`src/worker/index.ts`): add a second `cron.schedule` job,
  `0 0 * * 6` (Saturday 00:00 Asia/Dubai — cron's day-of-week 6), calling
  `runBinaryCycleCatchUp(new Date())`. This is the one place `new Date()`
  is appropriate in this code path (invariant #4) — the real scheduler
  entry point, not engine logic.

Plan:
- [x] Tests first (`binary-cycle-job.test.ts`, new file, mirrors
      daily-interest-job.test.ts's shape, including the
      `vi.spyOn(module.namespace, ...)` mock pattern for the
      failure-injection test): multi-week gap (3 missed weeks) catches up
      all of them in order, each getting its own binary_cycles row per
      user; an already-COMPLETED week is not reprocessed; true first-ever
      run only processes the most recently closeable week, not a
      backward walk; a failure partway through one week marks it FAILED
      and does not advance past it, retry then succeeds; only users with
      a binary_nodes row are processed (a never-placed root user gets
      zero binary_cycles rows).
- [x] `src/lib/binary-cycle-job.ts` (new file): implemented per the
      design above — `BINARY_CYCLE_JOB_TYPE`, `unprocessedWeeks`,
      `mostRecentCloseableWeekStart`, `runOneWeek`,
      `runBinaryCycleCatchUp`. Imports `closeBinaryCycleForUser` via a
      module namespace (`import * as binaryCycle from "./binary-cycle"`)
      specifically so the failure-injection test can `vi.spyOn` it,
      matching daily-interest-job.ts's exact reason for the same pattern.
- [x] `src/worker/index.ts`: wired in the second `cron.schedule` job,
      `0 0 * * 6` Asia/Dubai.
- [x] Two real bugs found and fixed while writing tests (not caught by
      design review):
      1. Test dates originally used `2026-08-01`-range weeks, which
         predate the real seeded `commission_config.effectiveFrom`
         (2026-08-20 in this dev DB) — `activeCommissionConfigAt` (a
         genuine historical lookup, working exactly as designed) correctly
         threw "no active commission_config found." Fixed by moving all
         test weeks to late Aug/Sept 2026, safely after the real seed
         date — a test-data bug, not an engine bug.
      2. A genuine off-by-one in how test dates were stamped: this
         project's convention (established in binary-cycle-close.test.ts's
         `WEEK_START`) is that Dubai-Saturday-00:00 for calendar date D is
         written as `(D-1)T20:00:00.000Z`, NOT `D T20:00:00.000Z` — Dubai
         is UTC+4, so its midnight is 20:00 UTC the PRIOR calendar day.
         Test dates initially used the calendar Saturday's own date
         directly (e.g. `2026-08-29T20:00:00.000Z` for calendar Sat
         08-29), which is actually Dubai SUNDAY 08-30 00:00 — one full
         week off from intended, causing `unprocessedWeeks` to compute a
         different (also internally-consistent, so not obviously wrong)
         set of weeks than the test expected. Traced via a scratch debug
         script confirming `saturdayWeekStart`'s real output against
         `Intl.DateTimeFormat`'s actual Dubai-local weekday, not by
         guessing. Fixed by using `(Saturday-date - 1)T20:00:00.000Z`
         throughout, matching the established convention exactly — the
         engine code (`saturdayWeekStart`, `mostRecentCloseableWeekStart`)
         was correct throughout; only the tests' own date literals were
         wrong.
- [x] Full suite: 38 files, 271/271 passing (266 prior + 5 new), including
      `reconciliation.test.ts` clean. `tsc --noEmit` clean. Confirmed via
      a single isolated run (no concurrent vitest processes, per the
      standing SCRUM-79 lesson).
- [x] Live verification in the running dev container (not just unit
      tests): `docker compose restart worker` to pick up the new code,
      confirmed via `docker compose logs worker` both cron jobs log their
      scheduled-on-startup lines ("daily interest job scheduled for 00:05
      Asia/Dubai" and "binary cycle job scheduled for Saturday 00:00
      Asia/Dubai"). Manually triggered `runBinaryCycleCatchUp(new Date())`
      via a scratch script run inside the app container against the real
      dev DB (`docker compose exec app npx tsx ...`) — built a real
      2-level tree (sponsor + LEFT/RIGHT referrals) via the real
      `registerAsRoot`/`registerWithSponsor`, funded and purchased real
      packages via the real `adminCreditWalletB`/`purchasePackage`, then
      ran the batch job for real. Confirmed a real `job_runs` row
      (`binary_cycle`, COMPLETED) and a real `binary_cycles` row were
      written — `qualified=false` for that specific run, correctly:
      the purchases happened "today" but the most recently closeable
      week's `weekEnd` was last Friday, before those purchases existed,
      so no BV had rolled up into that week yet (correct real-system
      behavior, not a bug). Hit and resolved the known
      host/container-Prisma-client-drift quirk (`docker compose exec app
      npx prisma generate`) along the way — a previously-documented class
      of issue, not re-investigated from scratch. Cleaned up all
      real data touched (users, investments, job_runs, binary_cycles)
      via a second scratch script; confirmed zero leftover
      `scrum80live-*` users and zero leftover `binary_cycle` job_runs
      rows afterward. Both scratch scripts deleted; `git status` confirms
      no trace.

## SCRUM-79: confirm carry-forward expiry is fully complete — DONE (2 real gaps found and fixed)

Audited SCRUM-78's expiry implementation against the phase brief's 3
specific claims, not just re-reading the summary:

1. **Age counter resets to null only on a FULL match to 0, not merely
   below-threshold** — confirmed correct by re-reading `nextSince()`:
   returns null iff `carryOut.isZero()`, otherwise preserves/starts
   `since`. Already had one passing test for this
   ("resets the expiry clock when a carry fully matches down to 0 in an
   intermediate week"). No gap.
2. **A side that matches occasionally/partially never ages out
   incorrectly** — found TWO real coverage gaps here, not just re-reading
   code:
   - No test proved a carry-in still INSIDE the expiry window (not yet
     expired) survives — only "well past expiry gets dropped" was
     tested, never the "correctly does NOT drop" direction. An inverted
     `>=`/`<=` or an addMonths off-by-one would have shipped undetected.
   - No test proved `carryLeftSince` stays pinned to its ORIGINAL start
     across MULTIPLE consecutive partial-match cycles — only a single
     -cycle partial match was covered (the worked-example test).
   Added both as new tests in `binary-cycle-close.test.ts`: a carry-in
   dated exactly one day inside the window survives fully, combining
   correctly with fresh BV; a 3-cycle scenario (seed -> partial match ->
   partial match) proves `carryLeftSince` never drifts forward on
   intervening partial matches, only resets when the side truly clears
   to 0. Found and fixed a test-authoring bug while writing the second
   test: reused the same `rightInvestment.id` for two different weeks'
   `bv_entries` rows, colliding with bv_entries' own
   UNIQUE(ancestorUserId, sourceInvestmentId) constraint — fixed by
   creating a second distinct investment for the second week's entry
   (a real fact about BV, not a workaround: each week's volume is tied
   to a real purchase event, so two different weeks' entries always need
   two different source investments).
3. **Tested against the REAL seeded default 6-month expiry, not an
   arbitrary duration** — confirmed already true: the existing expiry
   test reads `activeConfig.binaryCarryForwardExpiryMonths` dynamically
   rather than hardcoding a number, and a live DB query confirmed the
   real seeded value is genuinely 6. No gap — this claim was already
   satisfied by SCRUM-78's original test.
- [x] `binary-cycle-close.test.ts` now has 11 tests (9 from SCRUM-78 + 2
      new), all passing.
- [x] Full suite: 37 files, 266/266 passing, including
      `reconciliation.test.ts` clean, confirmed via a clean, single,
      non-overlapping run. `tsc --noEmit` clean. Verified zero leftover
      test users, exactly one active commission_config row remaining.
- [x] User pushed back on an initial under-verified claim: an earlier run
      showed 1 failure in `phase-4-exit-test.test.ts`, reported as
      "likely two overlapping vitest run processes" based only on a
      clean retry — correctly challenged as insufficient evidence given
      this project's history of intermittent issues that turned out
      real (SCRUM-61). Deliberately reproduced on demand (two `vitest
      run` processes started 5s apart, full untruncated logs captured)
      and confirmed the exact mechanism, now logged in lessons.md: (1)
      `commission_config`'s singleton row raced by both processes'
      historical-rate tests opening/closing it concurrently; (2)
      `phase-4-exit-test.test.ts`'s own documented SCRUM-54 hazard (it
      assumes exclusive control of every ACTIVE investment) firing for
      real, producing a genuine ledger idempotency-key collision; (3)
      `reconciliation.test.ts` correctly catching the resulting real
      drift in both concurrent runs. Cleaned up the 2 orphaned
      `exit-test-*` users left by the crash (standard
      cleanupLedgerEntriesForUsers + FK-safe order), re-verified
      `reconciliation.test.ts` clean standalone afterward.

**Confirmed: carry-forward expiry is fully complete and verified**
against all 3 specific claims in this ticket (2 real test-coverage gaps
closed), and the transient full-suite failure is now genuinely
understood (deliberately reproduced with full evidence, root cause
named and logged), not just assumed benign.

## SCRUM-78: weekly binary cycle close — DONE

Confirmed with user before implementing (two real ambiguities, not
guessed):
1. Carry Forward Expiry IS in scope for this ticket (not deferred) — the
   phase brief's exit test requires it and the schema's
   carryLeftSince/carryRightSince fields exist for exactly this.
2. Expiry drops ONLY the stale carry-in portion, never this week's freshly
   -arrived BV — `left = (carryLeftIn, zeroed if stale) + thisWeekLeft`,
   matching mlm_rules_log's exact wording ("the stale PORTION is dropped").

Design (worked through before coding):
- Per-user engine function `closeBinaryCycleForUser(userId, weekStart,
  weekEnd)` — mirrors accrueDailyInterestForInvestment's per-unit shape;
  a batch/job wrapper iterating every user + job_runs tracking is a
  separate follow-on ticket (matches the Phase 4 daily-interest vs.
  daily-interest-job split), NOT built here — out of scope per this
  ticket's own "for each user at cycle close" framing (singular unit).
- Idempotency: check for an existing binary_cycles row
  (unique(userId, weekStart)) up front; if found, return it unchanged —
  matches the ledger's own idempotency-replay shape, adapted since
  binary_cycles has no ledger row for the unqualified/no-payout path (so
  the guard must be on binary_cycles itself, not solely on a ledger
  lookup like postTransaction's).
- Carry-in: load the immediately preceding week's binary_cycles row
  (weekStart - 7 days) for this user. None found -> first-ever cycle,
  carryLeftIn/carryRightIn/*Since all zero/null.
- This week's fresh BV: sum bv_entries where ancestorUserId = userId AND
  cycleWeekStart = weekStart, grouped by leg (LEFT/RIGHT).
- Expiry check (on carry-IN only, before combining with fresh BV): if
  carryLeftSince is non-null and weekStart - carryLeftSince >
  commission_config.binaryCarryForwardExpiryMonths (the config row ACTIVE
  AT weekEnd, per invariant #6 — historical weeks always use the rate/
  config active during that week, not today's), the carry-in is dropped
  (treated as 0) rather than combined into `left`. Same for right,
  independently.
- left = (possibly-expired) carryLeftIn + thisWeekLeft; same for right.
- Qualification: user has >=1 investment with status ACTIVE, AND
  isLegActive(userId, "LEFT", weekEnd) AND isLegActive(userId, "RIGHT",
  weekEnd) — SNAPSHOTTED at weekEnd per SCRUM-77's load-bearing
  constraint, never re-queried live for an already-closed week by any
  future caller. qualificationReason set (non-null) only on the
  non-qualified path, explaining which condition failed (no active
  investment / left leg inactive / right leg inactive — first failing
  reason wins, doesn't enumerate all failures).
- If qualified: matched = min(left, right); rate = commission_config row
  active AT weekEnd (historical lookup, same pattern as dailyRate() in
  interest-rate.ts — NOT direct-commission.ts's "whatever's active now"
  shortcut, since binary commission's invariant #6 requirement is
  explicit and dailyRate already has the correct historical-lookup
  precedent to copy). commission = matched * binaryRate / 100, credited
  to Wallet C via postTransaction (CREDIT user / DEBIT SYSTEM_EXTERNAL,
  matching payDirectCommissionInTx's money-materializing pattern — binary
  commission is new money, not a transfer), fully available, no saving
  split. idempotencyKey `binary:{userId}:{weekStart}` shared with the
  binary_cycles row itself (both must exist together or neither does —
  same transaction).
- Carry forward: carryLeft = left - matched, carryRight = right -
  matched (matched only ever subtracted from BOTH, so exactly one side
  hits 0 when qualified — the weaker leg — per the spec's own math; if
  NOT qualified, matched = 0, so carryLeft/carryRight = left/right
  unchanged, matching "volume still carries forward in full").
- carryLeftSince (post-cycle): null if carryLeft == 0; else weekStart if
  this is a freshly-started carry (prior carryLeftSince was null, i.e.
  carryLeft was 0 last week or this is the first cycle); else carried
  forward unchanged from the prior cycle's carryLeftSince (the unmatched
  streak continues). Same independently for carryRightSince.
- Whole function runs in one DB transaction: idempotency check, all
  reads, the binary_cycles row write, and (if qualified) the ledger
  credit all commit or roll back together.

Plan:
- [ ] Tests first (`binary-cycle-close.test.ts`, new file):
      - **Exit-test worked example**: a user with carryLeftIn=8000 (from
        a seeded prior cycle) + this week's fresh BV such that
        left=15000/right=7000 total, both legs active, active investment
        -> qualified=true, matched=7000, commission=560 (8% of 7000)
        credited to Wallet C, carryLeft=8000 carried to output (15000-7000),
        carryRight=0. Confirms the exact spec numbers end-to-end.
      - Unqualified user (e.g. one leg inactive) accrues left/right totals
        into carryLeft/carryRight in full, matched=0, commission=0, no
        Wallet C credit, qualificationReason populated explaining why.
      - Qualified with left/right already equal -> matched = full amount,
        BOTH carryLeft and carryRight end at 0 (not just the "weaker" side
        -- when equal, matching exhausts both).
      - Historical rate correctness: seed a NEW commission_config row
        effective partway through, close a week whose weekEnd predates the
        change -> commission computed with the OLD rate, not the new one
        (mirrors interest-rate.test.ts's historical-lookup test shape).
      - Carry expiry: a carry-in whose carryLeftSince is older than
        binaryCarryForwardExpiryMonths is dropped (left = only this
        week's fresh BV, carry-in excluded) — construct via a seeded prior
        binary_cycles row with an old carryLeftSince, not by actually
        running binaryCarryForwardExpiryMonths real weeks of the engine.
      - Carry expiry reset: a carry that gets fully matched down to 0 in
        an intermediate week resets carryLeftSince to null that week, so
        a LATER unmatched carry starting fresh doesn't inherit the old age.
      - Idempotency: closing the same (userId, weekStart) twice returns
        the same binary_cycles row, creates no duplicate ledger entries,
        and does not double-write the row.
      - No prior binary_cycles row (first-ever cycle for this user):
        carry-in treated as 0/0, no crash on the "load prior week" lookup.
- [x] `src/lib/binary-cycle.ts`: added `closeBinaryCycleForUser(userId,
      weekStart, weekEnd)` implementing the design above, plus
      `activeCommissionConfigAt` (historical lookup, mirrors dailyRate's
      pattern — NOT direct-commission.ts's "currently active" shortcut),
      `applyExpiry`, `nextSince` helpers.
- [x] Real gap found and fixed mid-implementation, confirmed with user
      before proceeding (not guessed): mlm_rules_log Section 5's binary
      qualification rule lists only 3 conditions (active investment, left
      leg active, right leg active) — no explicit "user themselves not
      suspended" clause. But build_plan.md's cross-cutting rule requires
      every commission engine to skip suspended parties, and every
      sibling engine (daily interest, direct commission) already does.
      Added a 4th qualification check (`account_suspended`, checked
      first) so a suspended sponsor with two genuinely-active legs still
      correctly gets zero payout — confirmed via a dedicated test.
      `QualificationFailureReason` = "account_suspended" |
      "no_active_investment" | "left_leg_inactive" | "right_leg_inactive"
      (first failure wins, never enumerates more than one cause).
- [x] Tests first, new file `binary-cycle-close.test.ts` (9 tests, all
      passing): exact spec worked example (carryLeftIn 8000 + fresh BV ->
      left 15000/right 7000 -> matched 7000 -> commission 560 at the
      seeded 8% rate -> next cycle opens carryLeft 8000/carryRight 0,
      carryLeftSince correctly carried forward since still unmatched);
      unqualified user (inactive leg) carries volume in full, paid
      nothing, correct qualificationReason; equal left/right fully
      matches both sides to 0 (both carries null); historical rate
      correctness (closed the real commission_config row at a boundary
      AFTER this cycle's weekEnd, opened a new row with a deliberately
      different binaryRate starting at that boundary, confirmed the
      OLD rate was used — mirrors interest-rate.test.ts's exact
      boundary-crossing pattern, restored the singleton row in a
      `finally` block); carry expiry drops only the stale carry-in,
      never this week's fresh BV; expiry clock resets on a carry that
      fully matched to 0 in an intermediate week (next unmatched carry
      starts its own fresh age, doesn't inherit an ancient since);
      idempotent replay (same row returned, zero duplicate ledger
      entries, zero duplicate binary_cycles rows); first-ever cycle (no
      prior row) treated as carry-in 0/0 without crashing; suspended
      sponsor with two active legs and their own active investment is
      still correctly unqualified (`account_suspended`), zero commission,
      full carry forward.
- [x] Full suite: 37 files, 264/264 passing (255 prior + 9 new), including
      `reconciliation.test.ts` clean. `tsc --noEmit` clean. Verified zero
      leftover `close-*` test users, zero stray commission_config rows,
      and exactly one active (effective_to IS NULL) commission_config row
      remaining after cleanup.
- [x] Explicitly NOT built here (confirmed with user before implementing):
      the batch/job wrapper that iterates every user with a binary_nodes
      row and calls this per-user, with job_runs catch-up tracking —
      that's the natural next ticket (mirrors daily-interest-job.ts), out
      of scope for "for each user at cycle close" as a singular per-user
      engine function.

## SCRUM-77: leg-activity re-evaluation triggers — DONE

Confirmed approach with user before implementing (this was flagged as the
trickiest part of the phase, deliberately paused to propose rather than
guess):
- `isLegActive` (SCRUM-76) is already a live, uncached query — it re-derives
  correctness from `Investment.status`/`User.suspendedAt` on every call, so
  there is no stale cache for capital-release/suspension to invalidate
  "today." The real risk this ticket guards against is SCRUM-78's weekly
  cycle-close engine ever asking `isLegActive` for TODAY's live state when
  deciding a PAST week's qualification — that would let a Tuesday capital
  release retroactively change what last Friday's already-paid cycle
  "should have" looked like, and would make a re-run of a past week's
  processing non-reproducible (violates the spirit of invariant #6: once
  computed, a historical result must stay stable). So the real fix belongs
  to SCRUM-78 (leg activity gets snapshotted into `binary_cycles` AT
  cycle-close time, using that cycle's own week_end as `forDate` — never
  re-derived from "now" for a past week), not to this ticket.
- Given that, SCRUM-77 narrows to two concrete things:
  1. `suspendUser`/`reinstateUser` admin actions don't exist ANYWHERE in
     this codebase yet — grepped confirmed only `AccountSuspendedError`
     consumers and tests directly poking `suspendedAt` via
     `prisma.user.update`. The ticket needs a real "suspension event" to
     hang behavior on, so building these (USER_MANAGEMENT-gated, logged to
     admin_actions, matching adminCreateUser's permission-check pattern) is
     in scope here.
  2. Regression tests proving `isLegActive`'s live answer actually flips
     immediately after both trigger events (capital release via the real
     `releaseCapital`, suspension via the new `suspendUser`/
     `reinstateUser`) — not just via direct `prisma.update` field pokes
     like SCRUM-76's tests did, and specifically proving the ripple up
     MULTIPLE ancestor levels, not just the immediate parent.
- Explicitly NOT building in this ticket: any new "push"/notification/
  snapshot mechanism at release-or-suspend time — there is nothing yet to
  push into (SCRUM-78 doesn't exist yet), and building speculative
  plumbing ahead of its only consumer would be exactly the over-engineering
  CLAUDE.md warns against. SCRUM-78 must read leg activity via
  `isLegActive(userId, position, cycle.weekEnd)` at close time, snapshot
  the boolean into that cycle's row, and never re-query live state for an
  already-closed week.

Plan:
- [x] Added `AdminActionType.USER_SUSPENDED` / `USER_REINSTATED` via
      hand-written migration `20260822110000_add_user_suspend_reinstate_actions`
      (`ALTER TYPE ... ADD VALUE`, matching the exact precedent of
      `20260815123619_package_admin_actions`) + `migrate deploy` +
      `prisma generate`.
- [x] `src/lib/users.ts`: added `suspendUser(actingAdminId, targetUserId,
      { reason }, forDate)` / `reinstateUser(actingAdminId, targetUserId,
      { reason })`. Shared `assertHasUserManagementPermission` helper
      (main admin bypasses, else requires USER_MANAGEMENT grant, matches
      `adminCreateUser`'s pattern exactly). Both are no-op-safe (return
      the unchanged user, no admin_actions row written) for an
      already-suspended/already-active target rather than throwing —
      matches this codebase's "ordinary outcome" convention. Both log to
      `admin_actions` with the mandatory reason on an actual state change.
      `suspendUser` takes `forDate` explicitly (invariant #4); throws
      `CannotSuspendMainAdminError` for `isMainAdmin: true` targets
      (invariant #8 + no path to reverse it otherwise).
- [x] Tests first, extended `users.test.ts` (new `suspendUser /
      reinstateUser` describe block, 8 tests, all passing): main admin
      full suspend->reinstate flow with both admin_actions rows logged
      correctly; sub-admin with USER_MANAGEMENT allowed; sub-admin
      without it forbidden; non-admin actor forbidden; double-suspend is
      a no-op (no duplicate admin_actions row); reinstating an
      already-active user is a no-op (zero admin_actions rows); cannot
      suspend the main admin.
- [x] `binary-cycle.test.ts` (extended, new describe block "leg-activity
      ripple on capital release / suspension (SCRUM-77)", 2 tests, both
      passing): built a real 3-level tree (grandAncestor -> ancestor ->
      leaf, via registerWithSponsor/spillover) with a directly-created
      ACTIVE investment pinned to `capitalUnlocksAt = FRIDAY` (mirrors
      capital-release.test.ts's own pattern for exercising the real
      `releaseCapital` without waiting out an actual 6-month lock) —
      confirmed BOTH `ancestor`'s and `grandAncestor`'s LEFT legs flip
      active->inactive after a real `releaseCapital` call, not just the
      immediate parent. Mirror test using the new real `suspendUser`/
      `reinstateUser` (not a direct `prisma.update` poke): both ancestors'
      legs flip inactive on suspend, flip back active on reinstate.
- [x] Full suite: 36 files, 255/255 passing (246 prior + 8 suspend/
      reinstate + 2 ripple - 1 net vs. naive sum accounted for by
      pre-existing counts; reconciliation.test.ts and full run both
      confirmed clean regardless). `tsc --noEmit` clean. Verified zero
      leftover `ripple-*`/`suspend-*` test users after cleanup.

Explicitly NOT built here (confirmed with user before implementing):
no snapshot/notification mechanism at release-or-suspend time — SCRUM-78's
cycle-close engine is the sole future consumer, and it must read leg
activity via `isLegActive(userId, position, cycle.weekEnd)` AT close time
and snapshot the boolean into that cycle's `binary_cycles` row, never
re-querying live state for an already-closed week. This is the load
-bearing design constraint SCRUM-78 must follow.

- [x] Confirmed via capital-release.ts: `Investment.status` flips to
      CAPITAL_RELEASED immediately at release time (not backdated), so
      "currently holds capital" is genuinely a live `status === ACTIVE`
      check against current DB state — no point-in-time reconstruction
      needed. `forDate` param kept per invariant #4 even though this
      particular check doesn't use it for filtering, for signature
      consistency with the rest of the engine (SCRUM-77 will need it).
- [x] `src/lib/binary-cycle.ts`: added `isLegActive(userId, position,
      forDate): Promise<boolean>`.
      1. Finds the direct child of `userId`'s binary_nodes row at
         `position` (LEFT or RIGHT) — none -> empty leg -> false.
      2. Subtree membership via materialized path prefix
         (`path: { startsWith: legRoot.path }`) — correctly includes the
         child itself and everyone below.
      3. One query: `findFirst` on binary_nodes with a nested `user`
         relation filter (`suspendedAt: null` AND
         `investments: { some: { status: "ACTIVE" } }`) — a single joined
         query, not N+1.
      Pure read function, no caching (explicit ticket scope — SCRUM-77
      handles caching/re-evaluation triggers).
- [x] Tests first, extended `binary-cycle.test.ts` (new `isLegActive`
      describe block, 5 tests, all passing): active investment deep in
      subtree (not a direct child) -> true; sole capital-holder has
      released capital (status flipped directly, matching
      capital-release.test.ts's own pattern of not re-exercising
      releaseCapital's Friday/6-month preconditions for an unrelated unit
      test) -> false; sole capital-holder suspended -> false; empty leg
      (no members) -> false; multiple members in the leg, only one holds
      active capital -> true.
- [x] User flagged a real gap after initial completion: a one-person leg
      (only a direct child, no grandchildren at all) sat untested between
      the "deep subtree" and "empty leg" cases — exactly the boundary
      where an off-by-one in the path-prefix match (e.g. requiring a
      segment strictly below the leg root) could hide. Added a 6th test:
      sponsor -> onlyChild (LEFT, no descendants), onlyChild purchases ->
      isLegActive returns true. Confirmed the existing `startsWith`
      implementation already handles this correctly (a node's own path
      matches its own prefix, not just strictly-longer descendant paths)
      — no code change needed, test-coverage gap only.
- [x] Full suite: 36 files, 246/246 passing (240 prior + 6 new), including
      `reconciliation.test.ts` clean. `tsc --noEmit` clean. Verified zero
      leftover `legactive-*` test users after cleanup.

## SCRUM-75: binary_cycles table — DONE

- [x] Read phase-08 brief, mlm_rules_log.md Section 5 in full, build_plan.md
      Part 3 schema + Part 6 item 6, lessons.md in full.
- [x] Designed `BinaryCycle` model matching existing conventions exactly
      (Decimal(24,8), snake_case @map, RESTRICT FK to users per invariant
      #7, UNIQUE(user_id, week_start) + separate `idempotency_key @unique`
      column matching the WalletTransfer/WithdrawalRequest pattern rather
      than job_runs' composite-only pattern, since the brief explicitly
      calls out `binary:{user_id}:{week_start}` as its own key format).
      Confirmed with user: `qualificationReason` stays null when qualified
      (only populated to explain the non-payment path), not always
      populated.
- [x] Showed schema diff to user before running migration; user confirmed
      proceed.
- [x] Hand-written migration `20260822100000_add_binary_cycles` +
      `migrate deploy` (standing rule — this repo uses hand-edited
      migrations from Phase 2 onward, `migrate dev` is never used).
- [x] Added inverse `binaryCycles BinaryCycle[]` relation on `User`.
- [x] `prisma migrate status` clean (25 migrations, schema up to date),
      `tsc --noEmit` clean, `\d binary_cycles` confirmed real table
      structure matches the schema exactly (all Decimal(24,8) columns,
      RESTRICT FK, both unique indexes, week_start index). Schema only —
      no engine logic yet, that's a later ticket.

# Phase 7 — Placement Tree & BV Rollup

## SCRUM-69: binary_nodes table — DONE

- [x] Added `BinaryNode` model (`binary_nodes`, migration
      `20260821130000_add_binary_nodes`, applied via `migrate deploy` per the
      standing hand-edited-migration rule) — `userId` is the primary key
      itself (1:1 with users, not a separate `id` + unique constraint),
      `parentId` self-references `binary_nodes.user_id` (nullable for root),
      `position` enum LEFT/RIGHT (nullable — only the root has none), `path`
      materialized (cuid segments, e.g. `/cuid1/cuid2/cuid3/` — the doc's
      `/1/4/9/` example is illustrative, this project uses cuids not
      sequential ints), `depth` int. Both FKs `ON DELETE RESTRICT` (matches
      invariant #7, no hard delete on users). Indexed on `parentId` and
      `path`.
- [x] Confirmed via `\d binary_nodes` and `prisma migrate status` /
      `tsc --noEmit` clean.

## SCRUM-70: placement algorithm (BFS, weaker-BV leg) — DONE

Confirmed with user before implementing:
- Cached per-node BV total needs a schema addition now (leftBv/rightBv on
  binary_nodes) rather than summing subtrees on every registration — the
  phase brief explicitly suggests this. SCRUM-71 (BV rollup) will be what
  actually increments these to nonzero values; this task adds the columns
  and reads/writes them (always 0 delta at registration time, since a
  brand-new node contributes no BV of its own).
- Tie-break rule (equal or zero BV on both legs): always prefer LEFT,
  deterministic and simplest, matches the phase brief's own suggested
  default. The "first two referrals become direct LEFT then RIGHT children"
  behavior falls out of this rule naturally (LEFT fills on referral 1,
  becomes occupied, so referral 2's LEFT-preference finds LEFT taken at the
  sponsor and takes RIGHT) — not a special-cased "first two children" rule.

Plan:
- [ ] Migration: add `leftBv`/`rightBv` `Decimal(24,8)` columns to
      `binary_nodes`, default 0. Hand-written migration +
      `migrate deploy` (standing rule).
- [ ] `src/lib/binary-tree.ts` (new file): `placeInBinaryTree(sponsorId,
      newUserId, tx)`:
      1. Load the sponsor's `binary_nodes` row. If the sponsor has none yet
         (e.g. a root user who was never placed as anyone's referral),
         create it as a tree root: `parentId: null`, `position: null`,
         `path: "/{sponsorId}/"`, `depth: 0`, `leftBv/rightBv: 0` — a
         sponsor must have a placement node before their own referral can
         be placed relative to it.
      2. Pick target leg at the sponsor: `leftBv <= rightBv ? LEFT : RIGHT`
         (covers both the tie and the empty case, per the LEFT-preference
         rule).
      3. BFS from the sponsor's direct child on that leg (if empty, the
         slot is the sponsor's own direct child — done immediately). BFS
         queue explores nodes leg-subtree-wide; at each dequeued node,
         check LEFT then RIGHT for an open child slot (checked via
         `parentId` absence at that position, not a separate "has children"
         field) — first open slot found (LEFT-checked-before-RIGHT at each
         node, standard BFS/queue order) wins.
      4. Create the new `binary_nodes` row: `parentId` = the found node's
         userId, `position` = the found open slot's side, `path` = parent's
         path + newUserId + '/', `depth` = parent's depth + 1, `leftBv`/
         `rightBv` = 0.
      5. Takes `tx: Prisma.TransactionClient` (required, not optional) —
         called from the registration flow inside the same transaction as
         user creation, matching `isDirectCommissionTriggerPurchase`'s
         reasoning: two concurrent registrations under the same sponsor
         must not both read the same "first open slot" and collide:
         relies on the FK + this being invoked inside the caller's write
         transaction for consistency, no separate advisory lock added
         (matches this codebase's existing pattern of leaning on tx
         atomicity rather than explicit locking elsewhere).
- [ ] Wire into `src/lib/users.ts`: both `registerWithSponsor` and
      `adminCreateUser` (when a sponsorId is given) call
      `placeInBinaryTree(sponsorId, user.id, tx)` inside their existing
      transaction, right after `tx.user.create(...)`. `registerAsRoot`
      does NOT call it — a root user gets no placement node until/unless
      they later sponsor someone (lazily created at that point, per step 1
      above) or an admin explicitly wants every root pre-placed (out of
      scope here per the ticket's own framing: this ticket is about the
      placement algorithm itself, not about backfilling roots).
- [ ] Tests first (`binary-tree.test.ts`):
      - sponsor with an empty tree: first referral placed as sponsor's
        direct LEFT child (position, parentId, path, depth all correct);
        second referral placed as sponsor's direct RIGHT child (both legs
        at 0 BV, LEFT already taken -> RIGHT chosen)
      - third referral (spillover): with both direct slots full, BFS finds
        the first open slot down the weaker leg (construct a case where
        it's unambiguous which leg is weaker via manually-seeded
        leftBv/rightBv, then confirm placement lands under the correct
        existing node via BFS order, not as some other structure)
      - tie resolution: explicit equal nonzero leftBv/rightBv at the
        sponsor deterministically picks LEFT every time (call multiple
        times / assert repeatably, not just once)
      - placement targets the sponsor's tree specifically: two independent
        sponsors' trees don't interfere — placing under sponsor A never
        touches or reads sponsor B's nodes/BV
      - a sponsor with no existing binary_nodes row (root never previously
        placed) gets lazily created as a tree root before their referral
        is placed under them
- [x] Migration `20260821140000_add_binary_nodes_bv_cache`: added
      `leftBv`/`rightBv` Decimal(24,8) columns to `binary_nodes`, default 0.
      Applied via `migrate deploy` + `prisma generate`.
- [x] `src/lib/binary-tree.ts`: `placeInBinaryTree(sponsorId, newUserId,
      tx)`. Real algorithm bug found and fixed during testing (not caught
      by design review): the first draft picked a weak leg once at the
      sponsor (tie -> LEFT) and then BFS'd only within that leg's subtree —
      so on a 0/0 tie, the second referral spilled deeper into LEFT
      (since LEFT's direct slot was already taken) instead of landing in
      the sponsor's still-empty RIGHT slot, breaking the "first two
      referrals become direct LEFT/RIGHT children" requirement. Confirmed
      fix with user: an open direct slot at the sponsor always wins over
      spilling deeper, regardless of BV — the BV-weak-leg-then-BFS logic
      only kicks in once BOTH of the sponsor's direct slots are already
      taken. `getOrCreateRootNode` lazily creates a binary_nodes row for a
      sponsor who has none yet (a root user who's never been placed
      themselves, since only sponsored placements are wired in, not
      registerAsRoot).
- [x] Wired into `src/lib/users.ts`: `registerWithSponsor` always calls
      `placeInBinaryTree`; `adminCreateUser` calls it only when a
      `sponsorId` was given. `registerAsRoot` does not call it (no
      placement to make relative to since there's no sponsor) — a root
      user's own node is created lazily, on demand, the first time they
      sponsor someone.
- [x] `src/lib/binary-tree.test.ts`: 6 tests, all passing — first two
      referrals land as direct LEFT then RIGHT children; a third referral
      spills via BFS to the correct existing node's open slot (not a third
      direct child); an explicit BV tie at the sponsor resolves to LEFT
      deterministically across two consecutive calls; two independent
      sponsors' trees never interfere (including BV totals staying
      untouched); a sponsor with no pre-existing binary_nodes row gets one
      lazily created as a tree root before their referral is placed;
      placing under a nonexistent sponsor id throws (FK violation, not a
      silently wrong placement).
- [x] Found and fixed a real gap surfaced only by running the FULL suite
      (not just the new file): `users.test.ts` and `direct-commission.test
      .ts` both predate binary_nodes and clean up in the order
      securityQuestion -> walletAccount -> user, which now fails on
      `binary_nodes_user_id_fkey` (RESTRICT) since those files' sponsor
      -chain tests now create binary_nodes rows as a side effect of calling
      `registerWithSponsor`. Fixed by adding `binaryNode.deleteMany` before
      `user.deleteMany` in both files' `afterAll`.
- [x] The first full-suite run (before that fix) left 28 orphaned
      binary_nodes-linked test users behind from its failed cleanup.
      Investigated before deleting anything: queried exactly which users
      binary_nodes referenced (all matched the `direct-commission-*`/
      `sponsor-*`/`referred-*`/`list-*` naming from those two files' own
      test runs, none were the main admin), then found 31 MORE unrelated
      `test.local` leftover users (`pkg-admin-*`/`pkg-user-*`, dated back to
      2026-08-15 — pre-existing leftover data from Phase 3, not from this
      session) while scoping the cleanup query. Removed all 59 as one
      cleanup pass (all clearly test-pattern emails, zero real users, zero
      main admin) via a scratch script using `cleanupLedgerEntriesForUsers`
      + a leaf-first repeated-delete loop for binary_nodes (self-FK
      RESTRICT means children must go before parents) — not a plain
      `deleteMany`, which would fail the same way the test cleanup did.
      Verified `reconciliation.test.ts` clean after, then ran the full
      suite fresh as final proof: 33 files, 228/228 passing. Scratch
      scripts deleted; `git status` confirms no trace.
- [x] Full suite: 33 files, 228/228 passing, including
      `reconciliation.test.ts` clean. `tsc --noEmit` clean.

## SCRUM-71: bv_entries table + BV rollup on purchase — DONE

Confirmed with user: `bv_entries.cycle_week_start` needs a real Saturday
-start weekly-cycle boundary (Asia/Dubai), not just the raw purchase
timestamp — adding a small `saturdayWeekStart(forDate): Date` helper as
part of this task (the actual weekly binary-commission cycle/payout logic
itself is out of scope here, this is only for correctly stamping the
column).

Plan:
- [ ] Migration: `bv_entries` table — id, ancestorUserId (FK ->
      binary_nodes.user_id, since every ancestor already has a node by
      construction), sourceInvestmentId (FK -> investments.id), leg
      (LEFT|RIGHT), amount Decimal(24,8), cycleWeekStart, createdAt.
      `UNIQUE(ancestor_user_id, source_investment_id)` — prevents an
      ancestor from ever double-counting the same purchase (also acts as
      the replay guard, no separate idempotency key needed since this
      isn't a ledger write).
- [ ] `src/lib/binary-cycle.ts` (new, small): `saturdayWeekStart(forDate:
      Date): Date` — walks back to the most recent Saturday 00:00 in
      Asia/Dubai, mirrors `isFriday`'s Intl.DateTimeFormat pattern from
      interest-rate.ts. Small test file alongside.
- [ ] `src/lib/binary-tree.ts`: add `rollupBvForPurchase(investmentId,
      buyerId, amount, forDate, tx)`:
      1. Load the buyer's binary_nodes row (path, e.g.
         `/root/.../grandparent/parent/buyer/`).
      2. Parse `path` into its ordered list of ancestor user ids
         (everyone strictly above the buyer — the buyer's own trailing
         segment excluded).
      3. For each ancestor, walking from the buyer's direct parent up to
         the root: the "leg" is which of the ancestor's two direct
         children the chain passes through next — read directly off the
         next path segment's own binary_nodes.position (LEFT/RIGHT), not
         re-derived some other way.
      4. For each (ancestor, leg): skip if a bv_entries row already
         exists for (ancestorUserId, sourceInvestmentId) — replay guard.
         Otherwise: create the bv_entries row, and atomically increment
         that ancestor's binary_nodes.leftBv or rightBv by `amount`
         (`{ increment: amount }`, not a read-then-write, to stay correct
         under concurrent purchases in different transactions).
      5. cycleWeekStart = `saturdayWeekStart(forDate)`.
      Takes `tx: Prisma.TransactionClient` (required) — must run inside
      the same transaction as the purchase/investment write, matching
      payDirectCommissionInTx's reasoning.
- [ ] Wire into `src/lib/investments.ts`: `purchasePackage` calls
      `rollupBvForPurchase(investment.id, userId, pkg.amount, data.forDate,
      tx)` right after `payDirectCommissionInTx`, only on the
      newly-created path. Package purchases ONLY — never called from
      daily-interest, direct-commission, saving-lots, capital-release, or
      admin-credit code paths (per the BV definition: purchases only,
      never profits/commissions/rank rewards/transfers).
- [ ] Tests first (`binary-tree.test.ts`, extending the existing
      describe blocks, or a new `bv-rollup.test.ts` — decide at build
      time based on file size):
      - a purchase at the bottom of a real multi-level tree (built via
        real registerWithSponsor/spillover placements, not hand-crafted
        binary_nodes rows) creates a bv_entries row for EVERY ancestor up
        to the root, each with the correct leg (cross-check against each
        ancestor's actual position relative to the buyer) and the correct
        amount; cached leftBv/rightBv on every ancestor's binary_nodes
        row matches the sum of bv_entries for that ancestor exactly.
      - a DAILY_INTEREST credit and a DIRECT_COMMISSION credit each
        create zero bv_entries rows and leave every ancestor's
        leftBv/rightBv unchanged (call the real accrual/commission
        functions, not a simulated ledger write).
      - replaying rollupBvForPurchase for the same investmentId a second
        time creates no duplicate bv_entries rows and does not
        double-increment any ancestor's cached BV.
      - end-to-end via purchasePackage itself (not just the internal
        rollup function directly): one purchase call results in correct
        bv_entries + cached totals for the whole ancestor chain in one
        step.
- [x] Migration `20260822090000_add_bv_entries`: `bv_entries` table — id,
      ancestorUserId (FK -> binary_nodes.user_id, RESTRICT), sourceInvestmentId
      (FK -> investments.id, RESTRICT), leg, amount Decimal(24,8),
      cycleWeekStart, createdAt. UNIQUE(ancestor_user_id,
      source_investment_id). Applied via `migrate deploy` + `prisma generate`.
- [x] `src/lib/binary-cycle.ts`: `saturdayWeekStart(forDate): Date` — walks
      back to the most recent Saturday 00:00 Asia/Dubai, mirrors
      interest-rate.ts's isFriday Intl.DateTimeFormat pattern. 4 tests in
      `binary-cycle.test.ts`, all passing (same-Saturday input, mid-week
      walk-back, Friday-closes-the-week case, UTC/Dubai boundary case).
- [x] Found and fixed a real, previously-latent environment gap while
      building this file: `config.ts`'s env validation silently depended
      on something ELSE in the module graph importing `./prisma` first,
      because `@prisma/client`'s runtime bundles `dotenv` and loads `.env`
      as a side effect of `new PrismaClient()` — `config.ts` itself never
      loaded `.env`. Every existing test file happened to import
      `./prisma` transitively, so this never surfaced until
      `binary-cycle.ts` (a pure function needing only `config.TIMEZONE`,
      no DB access) didn't. Confirmed with user and fixed: added
      `import "dotenv/config"` at the top of `config.ts` itself, so any
      module reading `config.*` is self-sufficient. Verified via
      `binary-cycle.test.ts` run in complete isolation (no other file),
      which failed with `DATABASE_URL`/`SEED_ADMIN_*` validation errors
      before the fix and passes cleanly after.
- [x] `src/lib/binary-tree.ts`: added `rollupBvForPurchase(investmentId,
      buyerId, amount, forDate, tx)`. Parses the buyer's binary_nodes
      `path` into ordered ancestor ids, walks from the buyer's direct
      parent up to the root; at each ancestor, the leg is read directly
      off the next path segment's own `position` (LEFT/RIGHT) — not
      re-derived any other way. Skips (no-op) any ancestor that already
      has a bv_entries row for this investmentId (replay guard, backed by
      the UNIQUE constraint). Increments leftBv/rightBv via Prisma's
      `{ increment: amount }`, not read-then-write, so it stays correct
      under concurrent purchases. No-ops entirely if the buyer has no
      binary_nodes row at all (a root user who's never sponsored anyone —
      no ancestors possible either way).
- [x] Wired into `src/lib/investments.ts`: `purchasePackage` calls
      `rollupBvForPurchase` right after `payDirectCommissionInTx`, inside
      the same transaction, only on the newly-created path — matches the
      existing Direct Commission wiring pattern exactly.
- [x] Tests first, `src/lib/bv-rollup.test.ts` (new file, 3 tests, all
      passing): a purchase at the bottom of a real 4-level tree (built via
      real registerWithSponsor/spillover, not hand-crafted binary_nodes
      rows) creates a correctly-legged bv_entries row for every ancestor
      up to the root, with cached leftBv/rightBv matching exactly, and
      zero entry for the buyer themselves; a DAILY_INTEREST credit (via
      the real `accrueDailyInterestForInvestment`) and the purchase's own
      DIRECT_COMMISSION side effect together still produce exactly one
      bv_entries row per ancestor (the purchase's own), proving interest
      accrual specifically adds none; replaying the same investment's BV
      rollup both end-to-end (via a duplicate `purchasePackage` call,
      same idempotencyKey) and by directly re-invoking
      `rollupBvForPurchase` for the same investmentId creates no
      duplicate bv_entries and does not double-increment any ancestor's
      cached BV.
- [x] Audited existing test files per the SCRUM-70 RESTRICT-FK lesson
      before declaring done: `direct-commission.test.ts` and
      `users.test.ts` both create investments via sponsored purchases
      (which now generate bv_entries rows) and both called
      `investment.deleteMany` in their cleanup — added
      `bvEntry.deleteMany({ where: { sourceInvestmentId: { in:
      createdInvestmentIds } } })` before `investment.deleteMany` in both.
      Confirmed `investments.test.ts` needed no change (uses
      `registerAsRoot` only, no sponsor, so `rollupBvForPurchase` always
      no-ops there — zero bv_entries ever created for that file).
- [x] Full suite: 35 files, 235/235 passing (228 prior + 4 binary-cycle +
      3 bv-rollup new), including `reconciliation.test.ts` clean. `tsc
      --noEmit` clean. Verified zero leftover bv_entries/binary_nodes/
      test.local users after cleanup.

## SCRUM-73: tree visualization UI (react-d3-tree, RTL) — DONE

Confirmed with user before building:
- Fetch depth capped at a fixed depth (5-6 levels) from the logged-in
  user's own node, not the whole unbounded subtree — reasonable first
  version, avoids a slow query/cluttered render for a user with a large
  downline.
- RTL mirroring: keep the tree DATA exactly as-is in both locales (LEFT
  child always first, RIGHT always second, position field never touched)
  and mirror the rendered SVG visually via `scaleX(-1)` on the container
  in `/ar`, with a second `scaleX(-1)` on each node's text label group so
  text reads correctly (double-flip). This keeps LEFT/RIGHT strictly a
  data fact read from `binary_nodes.position`, never derived from render
  order or screen side — matches the phase brief's explicit warning.

Plan:
- [ ] `npm install react-d3-tree` — first graph/chart library in the
      project (no recharts/d3 precedent to follow). Confirm no peer-dep
      conflict with React 19.1.0 at install time.
- [ ] `src/lib/binary-tree.ts`: add `getMySubtree(userId, maxDepth)` — no
      target-user param (invariant #9, matches every other page's
      pattern). Loads the user's own binary_nodes row, then recursively
      (or via repeated `findMany({ where: { parentId: { in: [...] } } })`
      breadth-by-breadth, bounded by maxDepth) loads descendants down to
      the depth cap. Returns a plain nested structure: `{ userId, name,
      position, children: [...] }` — needs each node's `name` (join
      against `users.name`) for display, not just the raw userId.
- [ ] Tests first (`binary-tree.test.ts` or new
      `binary-tree-subtree.test.ts`): a user with no downline gets an
      empty children array (not an error); a multi-level real tree
      (built via registerWithSponsor/spillover) returns the correct
      shape with correct LEFT/RIGHT positions at each level; depth cap is
      respected (a deeper real branch doesn't appear beyond maxDepth);
      never includes another user's subtree (ownership/isolation, mirrors
      the SCRUM-70 cross-sponsor isolation test).
- [ ] `src/app/[locale]/binary-tree/page.tsx` (server component,
      `requireSession`-protected, matches referrals/page.tsx structure):
      loads translations + locale, `requireSession(new Date())`, calls
      `getMySubtree(user.id, depthCap)`, renders header + a client tree
      component. Empty/leaf state (no downline at all) handled inside the
      client component, not a separate page branch.
- [ ] `binary-tree-view.tsx` (client component, `"use client"`):
      - Converts the plain subtree shape into react-d3-tree's expected
        `{ name, attributes, children }` node format. `attributes` carries
        the position (LEFT/RIGHT) as a data attribute rendered in a
        custom node label — read directly from the fetched data, never
        derived from the node's rendered x/y position or tree traversal
        order.
      - RTL: wraps the react-d3-tree container in a div with
        `style={{ transform: locale === "ar" ? "scaleX(-1)" : undefined
        }}`, and applies the counter `scaleX(-1)` on each custom node's
        text-rendering group so labels read correctly. Tested explicitly
        in `/ar` per the phase brief and bilingual-rtl skill — not just a
        translation-key check.
      - Custom `renderCustomNodeElement` (not the library's default
        circle) matching this project's card-based visual language:
        rounded rect, name, LEFT/RIGHT badge (English word, never
        translated — matches the glossary rule for MLM structural terms),
        BV or purchase indicator if easily available.
      - Empty/leaf state: the logged-in user's own node renders alone
        with no children, plus a short empty-state message/CTA
        (translated) below or beside the tree, not just a bare single
        node with no explanation.
      - Zoom/pan enabled (react-d3-tree default `zoomable`/`draggable`),
        since even a depth-capped tree can be wide.
- [ ] `loading.tsx` skeleton matching the page's shape (header +
      placeholder tree-shaped skeleton block).
- [ ] i18n: new `BinaryTree` namespace in both messages/en.json and
      messages/ar.json in this commit. "LEFT"/"RIGHT" (or however the
      leg is surfaced) stay English per the glossary (matches Wallet
      A/B/C, BV, etc. — these are MLM structural terms, not general UI
      text) — confirm this reading of the glossary rule against the
      bilingual-rtl skill before finalizing the label text.
- [ ] RTL pass per lessons.md's recurring category: grep new files for
      physical left-*/right-*/ml-*/mr-*/pl-*/pr-*/text-left/text-right;
      explicit `flex flex-row items-center gap-2` for any icon+text pair
      outside the SVG itself.
- [ ] Manual verification in the running dev container: a user with zero
      downline (empty/leaf state) and a user with a real multi-level
      downline (built via the real placement algorithm, not fabricated
      tree JSON), in both `/en/binary-tree` and `/ar/binary-tree` —
      specifically confirm the SAME node's LEFT/RIGHT label and BV/position
      data are identical in both locales while the visual left-right
      screen position mirrors, proving the render is a pixel-level flip
      and not a data reordering.
- [x] `npm install react-d3-tree` (v3.6.6) — first graph/chart library in
      the project. No peer-dep conflict with React 19.1.0 (its
      peerDependencies range explicitly covers 16.x-19.x).
- [x] `src/lib/binary-tree.ts`: added `getMySubtree(userId, maxDepth)` +
      exported `SubtreeNode` type. No target-user param (invariant #9).
      Breadth-by-breadth fetch (one query per depth level via
      `findMany({ where: { parentId: { in: [...] } } })`), not a single
      deep nested Prisma `include` chain or an unbounded recursive query.
      Returns `null` if the user has no binary_nodes row at all (never
      placed) — the UI's empty-state trigger. `position` is copied
      verbatim from `binary_nodes.position` for every node (root's own
      position is always null in its own subtree — not meaningful there).
      5 tests in `binary-tree-subtree.test.ts`, all passing: null for an
      unplaced user; leaf state (empty children) for a user with a
      downline of their own that has no further downline; correct
      multi-level shape with correct LEFT/RIGHT at each level; depth cap
      respected against a real deeper branch; cross-sponsor isolation.
- [x] `src/app/[locale]/binary-tree/{page.tsx, binary-tree-view.tsx,
      loading.tsx}` — server component matches referrals/page.tsx's
      structure exactly (`requireSession(new Date())`, no target-user
      param). Depth capped at 5. Client component converts the plain
      subtree into react-d3-tree's `RawNodeDatum` shape, copying
      `position` straight from the fetched data into each node's
      `attributes` — never derived from array order or recursion order.
- [x] RTL mirroring: data (child order, position field) is IDENTICAL in
      both locales. Only the rendered SVG container gets
      `transform: scaleX(-1)` in `/ar` (via a locale check, not a CSS
      media query, since it must track next-intl's locale not the OS/
      browser direction), with a second counter `scale(-1, 1)` on each
      node's text-label `<g>` so labels render un-mirrored (readable)
      while the tree layout itself flips. `translate.x` for react-d3-tree
      is also flipped (`dimensions.width - 40` in RTL vs `40` in LTR) so
      the root anchors to the correct starting edge post-mirror.
      LEFT/RIGHT badge text stays the literal English word in both
      locales (MLM structural term, not translated, per the bilingual-rtl
      glossary rule — same treatment as Wallet A/B/C).
- [x] i18n: new `BinaryTree` namespace added to both messages/en.json and
      messages/ar.json in this commit. Validated both files as parseable
      JSON. Grepped the new route's files for physical
      left-*/right-*/ml-*/mr-*/pl-*/pr-*/text-left/text-right — zero
      matches.
- [x] `tsc --noEmit` clean throughout.
- [x] Manual verification: no headless-browser/screenshot tool is
      available in this environment, so code-level checks were done
      first (route compiles, serves 200 for both locales, correct data
      reaches the client bundle, no server-side runtime errors in
      container logs) and flagged explicitly to the user as an
      incomplete substitute for an actual visual check, rather than
      claiming full verification. Set up two real verification users via
      a scratch script (a 3-level real tree built through
      registerWithSponsor/spillover — Root -> Left Child/Right Child ->
      Left Grandchild/Right Grandchild — plus a separate user with zero
      downline for the empty state) and gave the user login credentials
      to check in their own browser after their first session cookie
      expired mid-verification.
      User confirmed: tree renders correctly in both `/en` and `/ar`,
      RTL mirroring looks right, LEFT/RIGHT badges are consistent between
      locales for the same node. One data point flagged for explicit
      confirmation: "Right Grandchild" (under Right Child) shows a LEFT
      badge — verified directly against real binary_nodes rows via a
      scratch query and confirmed correct, not a bug: `position` is
      relative to a node's own DIRECT parent's two legs, never the
      overall tree side. Right Grandchild is Right Child's first-ever
      registered referral, so per SCRUM-70's placement algorithm (open
      direct slot always wins, LEFT before RIGHT) it fills Right Child's
      own LEFT slot — a node several levels down the "right side" of the
      tree can correctly carry a LEFT position of its own. This is
      exactly what `getMySubtree`'s docstring and the phase brief's core
      rule require (position is a data fact tied to direct placement, not
      "which half of the screen the node visually falls on").
- [x] Full suite: 36 files, 240/240 passing (235 prior + 5 new
      binary-tree-subtree tests), including `reconciliation.test.ts`
      clean. `tsc --noEmit` clean.
- [x] Cleaned up all 6 manually-created verification users (root, 4
      descendants, empty-state user) via `cleanupLedgerEntriesForUsers` +
      explicit session/securityQuestion/walletAccount/binaryNode cleanup
      before user deletion, confirmed via the cleanup script's own
      "Deleted users: 6" output. Scratch scripts deleted after use;
      `git status` shows no trace.

## SCRUM-74: Phase 7 exit test — RUN AND PASSED

Ran a real scratch script (`.scratch_exit_test_phase7.ts`, deleted after —
matches the Phase 3/5/6 exit-test convention) directly against the dev
database, using real lib functions (`registerAsRoot`/`registerWithSponsor`,
`adminCreditWalletB`, `purchasePackage`, `accrueDailyInterestForInvestment`),
not a re-run of the permanent unit suite. Migration state verified clean
first (`prisma migrate status`).

### Results (24/24 assertions passed)

**Scenario 1 — 4-level tree, bottom purchase rolls up BV on every
ancestor's correct leg:**
Built root -> a (root's LEFT; a sibling fills root's RIGHT so this isn't
just a default) -> b (a's LEFT) -> buyer (b's LEFT), then an $8,000
purchase by buyer.
- bv_entries rows exist for b, a, and root — all three, not just the
  direct parent
- All three entries: leg == LEFT (matches the buyer's real descent path,
  not assumed), amount == exactly 8000
- No bv_entries row for the buyer's own userId as an "ancestor" of itself
- Cached leftBv/rightBv on b/a/root all match the bv_entries sum exactly
  (leftBv == 8000, rightBv == 0 for every ancestor — the RIGHT sides
  those ancestors' siblings occupy are correctly unaffected)

**Scenario 2 — commission credit and interest accrual create zero
bv_entries:**
- Direct Commission fired automatically as part of the scenario-1
  purchase (buyer's sponsor b received it) — confirmed paid, then
  confirmed it added zero additional bv_entries rows beyond the
  purchase's own 3
- Daily interest accrued on the same investment (past profitStartsAt) —
  confirmed it actually credited interest, then confirmed zero additional
  bv_entries rows
- b's cached leftBv stayed exactly 8000 after both — no noise leaked into
  the cached BV totals from non-purchase money movement

**Scenario 3 — new registration placed on the lower-BV side of a
DELIBERATELY IMBALANCED tree (not a fresh all-zero tree):**
- Built a sponsor with both direct slots already filled (LEFT/RIGHT
  children), then manually set leftBv=50000, rightBv=1000 — RIGHT
  deliberately the weaker leg
- A new referral correctly spilled into the RIGHT child's own subtree
  (landed on RIGHT child's open LEFT slot), NOT under the stronger LEFT
  leg
- Re-imbalanced the same sponsor the other way (leftBv=500,
  rightBv=90000 — now LEFT is weaker) and registered again: the very
  next referral correctly spilled into LEFT instead — proves the
  placement algorithm genuinely reads the live BV comparison each time,
  not a fixed default that happened to look right once

### Cleanup and regression check
- Script's own cleanup used `cleanupLedgerEntriesForUsers`
  (idempotencyKey-scoped, SYSTEM_EXTERNAL-safe) per the standing
  structural rule, plus explicit `bvEntry`/`binaryNode` cleanup ordered
  before `investment`/`user` deletion (RESTRICT FKs, per the SCRUM-70/71
  lessons) — reported "Cleaned up 10 users, 1 packages, 1 investments."
- Verified zero leftover `phase7exit` users and zero leftover
  `bv_entries` rows in the DB after the script's own cleanup ran, via a
  separate scratch check, before even getting to the full-suite pass.
- Scratch scripts deleted; `git status` confirms no trace.
- Full suite: 36 files, 240/240 passing. `tsc --noEmit` clean.
- `reconciliation.test.ts` (the whole-database solvency check) explicitly
  re-run standalone as the final step, per the standing rule — 3/3
  passing on its own, not just bundled into the full-run count.

**PHASE 7 EXIT TEST: ALL 3 SCENARIOS / 24 ASSERTIONS PASSED. Full suite
clean, including standalone whole-database reconciliation.**

Phase 7 is complete pending user confirmation in the operation-room chat
per CLAUDE.md's build-order rule.

# Phase 6 — Sponsor Tree & Direct Commission

## SCRUM-63: commission_config table — DONE

- [x] Added `CommissionConfig` model (`commission_config`, migration
      `20260821120000_add_commission_config`, applied via `migrate deploy`
      per the standing hand-edited-migration rule) — directRate,
      directCommissionSplit, directSavingSplit, binaryRate,
      binaryCarryForwardExpiryMonths (default 6), effectiveFrom, effectiveTo.
      Rates stored as whole percentages (8.0, not 0.08), matching
      InterestRateConfig's existing monthlyRate convention.
- [x] "At most one active row" enforced via a partial unique index on a
      constant expression `((TRUE)) WHERE effective_to IS NULL`, same
      corrected pattern as `interest_rate_config` (indexing the nullable
      column itself doesn't work — verified live by inserting a real
      second active row and confirming it's rejected, not just trusting
      `\d` output).
- [x] Seeded: direct 8% (5/3 split), binary 8%, 6-month carry-forward
      expiry, effective_from = now, effective_to = NULL.
- [x] `prisma migrate status` clean, `tsc --noEmit` clean.

## SCRUM-64: first-purchase detection function — DONE

- [x] `src/lib/direct-commission.ts`: `isDirectCommissionTriggerPurchase
      (investmentId, tx: Prisma.TransactionClient)`. Deliberately not named
      `isFirstPurchase` — verbose/scoped name so Phase 9's MRV logic (every
      purchase counts, not just first, per docs/mlm_rules_log.md Section 6)
      can never be tempted to reuse or unify with it. `tx` is required (not
      optional like postTransaction's pattern) since correctness depends on
      running inside the same DB transaction as the eventual commission
      payout — a bare-prisma default would reintroduce the exact
      same-instant race the task called out.
      Order: `purchasedAt ASC, createdAt ASC, id ASC` — three-level
      deterministic tiebreak so two investments sharing the same
      `purchasedAt` (fabricated/backfilled dates, or same-millisecond
      concurrent inserts) still resolve to exactly one "first", never both
      or neither, and never flip-flop across repeated calls.
- [x] `src/lib/direct-commission.test.ts`: 4 tests — a user's only purchase
      is the trigger; a second purchase (different amount, separately
      funded) is not, while the first stays true; two purchases sharing
      the exact same instant resolve to exactly one trigger and stay
      stable across repeated re-checks; a nonexistent investment id throws
      rather than resolving ambiguously.
- [x] Explicitly out of scope for this task (per the ticket's own framing):
      wiring this into `purchasePackage` or triggering the actual
      commission payout — that's the next ticket.
- [x] Found and fixed an unrelated pre-existing issue while running the
      full suite: `daily-interest-job.test.ts`'s "true first-ever run"
      test failed (expected 0 prior `job_runs` rows, found 226) —
      confirmed via `git stash` that this reproduces identically with
      SCRUM-64's changes fully removed, so it's leftover data, not a
      regression. Root cause matched the exact SCRUM-51/52 pattern already
      logged in lessons.md: 226 `job_runs` rows from a prior interrupted
      manual/test run (`started_at` all clustered at one timestamp,
      `period_key` spanning 2026-01-01 through 2026-08-14), left behind in
      the shared dev DB. Deleted those 226 rows (`DELETE FROM job_runs
      WHERE job_type = 'daily_interest'`), re-ran the previously-failing
      test file alone (clean), then the full suite once more.
- [x] Also hit an infrastructure blip mid-verification: Docker Desktop
      became unresponsive partway through a full-suite run, which failed
      94 tests with `ECONNREFUSED`/"database server not running" — not a
      code issue. Confirmed via `docker compose ps` (failed to reach the
      Docker API), waited for the user to restart Docker Desktop, then
      confirmed all 3 containers healthy again before re-running.
- [x] Full suite (post Docker restart + job_runs cleanup): 32 files,
      207/207 passing, including `daily-interest-job.test.ts` and
      `reconciliation.test.ts` clean. `tsc --noEmit` clean. Verified zero
      leftover `direct-commission-*` test users and no orphaned
      investments after cleanup.

Plan:
- [ ] New file `src/lib/direct-commission.ts` (doesn't exist yet — this is
      the first Phase 6 lib file).
- [ ] Function named `isDirectCommissionTriggerPurchase` — deliberately
      verbose/scoped name, NOT `isFirstPurchase`, so it can never be
      reached for by Phase 9's MRV logic (which counts every purchase,
      not just the first — a different trigger for a different purpose,
      per the phase brief's explicit warning not to unify these).
      Signature: `isDirectCommissionTriggerPurchase(investmentId: string,
      tx: Prisma.TransactionClient): Promise<boolean>` — `tx` is REQUIRED,
      not optional (unlike postTransaction's pattern), because correctness
      here depends on running inside the same DB transaction as the
      commission payout that will follow it; a caller silently defaulting
      to a non-transactional read would reintroduce the exact race the
      task calls out.
      Logic: load the target investment (userId, purchasedAt, id, createdAt).
      Query that user's investments ordered by `purchasedAt ASC, createdAt
      ASC, id ASC` (three-level deterministic tiebreak — purchasedAt ties
      are possible with fabricated/backfilled dates, createdAt ties are
      possible at sub-millisecond granularity in rare concurrent-insert
      cases, id is the final deterministic tiebreak since cuids are unique).
      Take the first row's id; return whether it equals the target
      investment's id.
- [ ] Tests first (`direct-commission.test.ts`):
      - a user's very first (only) purchase is identified as the trigger
      - a second purchase by the same user (any amount, any funding
        source — simulate by funding B via commission-style credit
        rather than admin credit) is correctly identified as NOT the
        trigger, while the first one still is
      - two purchases sharing the exact same `purchasedAt` instant
        (fabricated identical date) resolve deterministically: exactly
        one is the trigger, never both, never neither, and re-running the
        check multiple times gives the same answer every time (no
        flip-flopping from query-plan nondeterminism)
      - a user with zero investments (edge case, shouldn't be called in
        practice but must not crash ambiguously) — decide behavior: throw,
        since calling this before the investment row exists is a misuse
- [ ] Full suite + `tsc --noEmit` after.
- [ ] Explicitly NOT doing in this task (scope): wiring this into
      `purchasePackage` or triggering the actual commission payout — that's
      the next task. This ticket is the detection function alone, per the
      task description.

## SCRUM-65: Direct Commission payout logic — DONE

- [x] `src/lib/direct-commission.ts`: added `payDirectCommission(investmentId,
      forDate)`. Uses `isDirectCommissionTriggerPurchase` as the sole gate
      (never re-derives first-purchase logic itself). No-ops (not throws)
      for: not-first purchase, no sponsor, suspended buyer, suspended
      sponsor — these are ordinary outcomes, not error conditions.
      Commission math reads the active `commission_config` row's
      `directCommissionSplit`/`directSavingSplit` fields directly (5.0/3.0),
      not derived from `directRate`.
- [x] Real bug caught by the tests (not by review): a single
      `postTransaction` call with all 4 entries under one shared
      `direct:{investmentId}` key fails — the ledger's idempotency
      uniqueness is `(key, coalesced_user, wallet, direction)`, and both
      splits' SYSTEM_EXTERNAL sides are `userId: null` /
      `wallet: SYSTEM_EXTERNAL` / `direction: DEBIT`, so under one shared
      key they collide with *each other*, not just with a genuine replay.
      Fixed by splitting into two `postTransaction` calls with distinct
      deterministic keys (`direct:{investmentId}:c` and
      `direct:{investmentId}:saving`), both inside the same outer
      transaction so the whole operation stays atomic; the `saving_lot`
      creation is guarded by its own `findFirst` check
      (`sourceInvestmentId`) rather than either call's `alreadyProcessed`
      flag alone, so a partial-retry scenario (one split's key already
      used, the other not) still can't double-create the lot.
      Money-materializing pattern matches `adminCreditWalletB`: CREDIT
      sponsor / DEBIT SYSTEM_EXTERNAL — Direct Commission is new money
      entering for the sponsor, not a transfer out of the buyer's balance
      (buyer already paid full price via purchasePackage's own B->A
      entries).
- [x] `src/lib/direct-commission.test.ts` (extended, `payDirectCommission`
      describe block): 6 new tests, all passing — exact 5%/3% split on a
      $10,000 purchase (sponsor C +500, SAVING +300, matching saving_lot
      with correct amount/sourceInvestmentId/unlocksAt = purchase date + 3
      months); no-sponsor buyer triggers nothing; a second (non-first)
      purchase triggers nothing regardless of amount while the first
      purchase's payout stays correctly in place; suspended sponsor blocks
      it; suspended buyer blocks it; replaying the same investmentId
      creates no duplicate ledger entries and no duplicate saving_lot.
- [x] Full suite: 32 files, 213/213 passing (207 prior + 6 new), including
      `reconciliation.test.ts` clean. `tsc --noEmit` clean. Verified zero
      leftover `direct-commission-*` test users and zero leftover
      `saving_lots` rows after cleanup.
- [x] Explicitly out of scope, per the ticket (not attempted): wiring
      `payDirectCommission` as an automatic call inside `purchasePackage`
      itself — this ticket built the payout function; whether/where it's
      invoked from the purchase flow is presumably the next ticket.

Plan:
- [ ] `src/lib/direct-commission.ts`: add `payDirectCommission(investmentId:
      string, forDate: Date): Promise<...>` (opens its own
      `prisma.$transaction`, matching `purchasePackage`'s pattern — this is
      called as a follow-up step after `purchasePackage` resolves, not
      threaded through its transaction, since `purchasePackage` doesn't
      expose its `tx` to callers today; not this ticket's scope to change
      that).
      Logic:
      1. Load the investment (userId = buyer, amount).
      2. `isDirectCommissionTriggerPurchase(investmentId, tx)` — if false,
         return a no-op result. Not-first purchases never reach the payout
         logic at all, regardless of amount (matches the exit test's
         "any amount" framing for the non-triggering case).
      3. Load the buyer; if buyer.sponsorId is null, no-op (no sponsor to
         pay). Load the sponsor by sponsorId.
      4. Skip (no-op, not an error) if either buyer or sponsor is
         suspended (`suspendedAt !== null`) — matches the Phase 5
         suspension-skip pattern used elsewhere (daily interest, binary
         legs), not a thrown error.
      5. Read the currently active `commission_config` row
         (`effective_to: null`).
      6. `commissionAmount = investment.amount * directCommissionSplit /
         100`, `savingAmount = investment.amount * directSavingSplit /
         100` — both computed from the config's split fields directly
         (5.0 and 3.0 today), not derived from directRate, since the
         splits are the actual payout percentages and directRate is
         effectively documentation that they sum to it.
      7. One `postTransaction` call with 4 entries (CREDIT sponsor's C +
         DEBIT SYSTEM_EXTERNAL for commissionAmount, CREDIT sponsor's
         SAVING + DEBIT SYSTEM_EXTERNAL for savingAmount), matching the
         `adminCreditWalletB`/SYSTEM_EXTERNAL pattern — Direct Commission
         is new money materializing for the sponsor, not a transfer out of
         the buyer's own balance (the buyer already paid full price via
         purchasePackage's separate B->A entries). All 4 entries share ONE
         idempotencyKey `direct:{investmentId}` in a single
         postTransaction call (not two separate calls) so the replay guard
         covers both splits atomically — two separate calls would let one
         split's idempotency succeed while the other independently
         replays.
         entryType DIRECT_COMMISSION for the C-side pair, DIRECT_SAVING
         for the SAVING-side pair (both enums already exist in schema).
         referenceType "investment", referenceId = investmentId on all 4.
      8. In the same transaction, create a `saving_lot` row: userId =
         sponsor.id, amount = savingAmount, sourceInvestmentId =
         investmentId (the field Phase 5 pre-added exactly for this),
         unlocksAt = forDate + 3 months, createdAt = default now.
      9. Skip/no-op cases (no sponsor, suspended party, not-first-purchase)
         must NOT create a saving_lot or ledger entries, and must NOT
         throw — a normal purchase by a root user or a second purchase is
         an expected, common case, not an error condition.
- [ ] Tests first (`direct-commission.test.ts`, extending the existing
      file): a qualifying first purchase with an active, unsuspended
      sponsor splits and credits correctly (sponsor C +5% exact amount,
      sponsor SAVING +3% exact amount, one matching saving_lot with
      correct amount/sourceInvestmentId/unlocksAt = purchase date + 3
      months); a buyer with no sponsor triggers nothing (zero ledger
      entries, zero saving_lots, no error); a second (non-first) purchase
      by an already-triggered buyer triggers nothing regardless of amount,
      even though that same buyer's sponsor exists and is eligible;
      suspended sponsor blocks the commission (buyer active, sponsor
      suspended -> no-op); suspended buyer blocks the commission (mirror
      case); replaying the same investmentId a second time creates no
      duplicate ledger entries and no duplicate saving_lot.
- [ ] `cleanupLedgerEntriesForUsers` for both buyer and sponsor ids in
      test cleanup (SYSTEM_EXTERNAL-safe pattern, mandatory per
      lessons.md). Explicit `savingLot.deleteMany` cleanup for
      sponsor-created lots (new table this task writes to, not covered by
      the existing investments.test.ts-style cleanup list).
- [ ] Full suite + `tsc --noEmit` after. Re-check `job_runs`/leftover-data
      state is still clean (per the SCRUM-64 cleanup) before declaring
      done, not just this file's own tests green.

## SCRUM-67: referral/commission UI — DONE

Confirmed with user: no `/register` UI route exists yet (Phase 10 work per
build_plan.md), so the referral "link" is displayed as the sponsor's raw
user id (a copyable code), not a fabricated full URL to a page that would
currently 404.

Also confirmed by survey: there is no app-wide nav/sidebar anywhere yet
(layout.tsx only has a language switcher) — matches the existing
packages/investments/withdrawals precedent of direct-URL-only pages, so no
nav link is added here either.

Plan:
- [ ] `src/lib/users.ts`: add `listReferralsForUser(sponsorId: string)` —
      `prisma.user.findMany({ where: { sponsorId }, orderBy: { createdAt:
      "desc" } })`, ownership enforced by construction (matches
      `listInvestmentsForUser`'s pattern exactly). Needs each referral's
      `suspendedAt` (for status) and whether they've made a purchase yet
      (join/include a minimal investments existence check) — decide at
      build time whether that's a separate query or an `_count` include.
- [ ] `src/lib/direct-commission.ts`: add
      `listDirectCommissionHistoryForUser(userId: string)` — reads
      `ledgerEntry.findMany({ where: { userId, entryType: {in:
      [DIRECT_COMMISSION, DIRECT_SAVING]}, direction: "CREDIT" },
      orderBy: { createdAt: "desc" } })` (sponsor-side CREDIT rows only,
      not the SYSTEM_EXTERNAL DEBIT side) — this is a new read function,
      not reusing anything existing verbatim.
- [ ] New route `src/app/[locale]/referrals/page.tsx` (server component,
      `requireSession`-protected, matches withdrawals/page.tsx structure):
      loads translations + locale, `requireSession(new Date())`,
      `Promise.all` for referrals list + commission history, renders:
      - referral code section (the user's own id, copy button)
      - direct referrals list (name/email masked appropriately, status
        badge: active/purchased vs suspended vs no purchase yet)
      - commission history list (amount, wallet C vs SAVING, date,
        referencing which referral triggered it if easily joinable)
      Each section has its own empty state.
- [ ] `referral-code-card.tsx` (client component, for the copy-to
      -clipboard interaction only — no server action needed, this page has
      no destructive/financial action, purely read + client-side copy).
- [ ] `referrals-list.tsx`: card grid or list matching
      investment-list.tsx's card pattern, status badge function
      (`default`/`secondary`/`destructive`) extended for this page's own
      referral-status semantics — not reusing withdrawal's status badge
      function directly (different status vocabulary).
- [ ] `commission-history-list.tsx`: matches b-exit-status-list.tsx's list
      pattern (amount, date, wallet destination badge).
- [ ] `loading.tsx` skeleton matching the page's shape.
- [ ] i18n: new `Referrals` namespace in both messages/en.json and
      messages/ar.json in this commit. Wallet C/SAVING/"Direct Commission"
      stay English per glossary; everything else translated.
- [ ] RTL pass per lessons.md's recurring category: every icon+text pair
      gets explicit `flex flex-row items-center gap-2`; grep new files for
      physical left-*/right-*/ml-*/mr-*/pl-*/pr-*/text-left/text-right
      before considering done.
- [ ] Manual verification in the running dev container: a sponsor with 0
      referrals (empty states), a sponsor with >=1 referral who has
      purchased (commission history populated) and >=1 who hasn't yet (no
      purchase), in both `/en/referrals` and `/ar/referrals`.
- [x] `src/lib/users.ts`: added `listReferralsForUser(sponsorId)` —
      `prisma.user.findMany({ where: { sponsorId } })`, newest first,
      returns `hasPurchased` derived from `_count.investments` (nothing to
      keep in sync — fully derivable). 4 new tests in `users.test.ts`:
      correct scoping (excludes an unrelated root user), empty array for
      no referrals, `hasPurchased` true/false correctly split across a
      real buyer vs non-buyer, suspended referral's `suspendedAt` reflected.
- [x] `src/lib/direct-commission.ts`: added
      `listDirectCommissionHistoryForUser(userId)` — CREDIT-only
      DIRECT_COMMISSION/DIRECT_SAVING entries, newest first; explicitly
      excludes the paired SYSTEM_EXTERNAL DEBIT side (same double-entry
      convention as every other ledger query in this codebase). 3 new
      tests: both C and SAVING sides returned correctly with matching
      investmentId, empty array with no history, never leaks another
      user's entries.
- [x] Built the full page: `src/app/[locale]/referrals/{page.tsx,
      referral-code-card.tsx, referrals-list.tsx,
      commission-history-list.tsx, loading.tsx}`. Confirmed with user: no
      `/register` route exists yet (Phase 10), so the referral code is
      displayed as the sponsor's raw user id with a copy button, not a
      fabricated URL. Confirmed by survey: no app-wide nav exists anywhere
      yet, so no nav link added — matches the existing direct-URL-only
      precedent from packages/investments/withdrawals.
- [x] Full `Referrals` i18n namespace added to both messages/en.json and
      messages/ar.json in this commit. "Direct Commission"/"Wallet
      C"/"SAVING" kept English per glossary in both locales (verified live
      in the Arabic render, not just in the JSON).
- [x] RTL pass: grepped all new files for physical
      left-*/right-*/ml-*/mr-*/pl-*/pr-*/text-left/text-right — zero
      matches. Icon+text pairs (copy button, empty-state icons) use
      explicit `flex flex-row items-center gap-2`.
- [x] Full suite: 32 files, 222/222 passing (215 prior + 7 new). `tsc
      --noEmit` clean.
- [x] Manual verification against the real running dev container (not
      just unit tests), as `browser-test@test.local`:
      - Empty-state pass (0 referrals, 0 commission history): both
        `/en/referrals` (200) and `/ar/referrals` (200, `dir="rtl"`)
        correctly show both empty states, referral code (own user id)
        displayed correctly in both locales.
      - Populated-data pass: created one non-buying referral and one
        buying referral (purchased via the real `purchasePackage`
        function inside the container, so `payDirectCommissionInTx`
        actually ran) under `browser-test@test.local`. Both `/en` and
        `/ar` correctly showed both referral cards with correct
        status badges ("No purchase yet" / "لا يوجد شراء بعد" for the
        non-buyer), and the commission history showed the real 500.00/
        300.00 C/SAVING credits with "Wallet C"/"SAVING" badges staying
        English in the Arabic render. Confirmed zero rendered empty
        -state containers in the populated HTML (a `border-dashed` grep
        returned 0) — an initial false alarm from matching the harmless
        embedded next-intl translation-catalog JSON, not an actual double
        -render bug.
      - Found and fixed the known dev-container quirks along the way (not
        new issues, matches standing lessons.md entries): a fresh route
        directory needed `docker compose restart app` before it stopped
        404ing (SCRUM-61's exact quirk), and the container's generated
        `@prisma/client` was missing `commissionConfig` until `docker
        compose exec app npx prisma generate` was re-run (Phase 3's exact
        host/container node_modules drift quirk) — both already-known
        classes of issue, not re-investigated from scratch.
      - Cleaned up all manually-created verification data afterward: test
        users/investments deleted, the sponsor's two real commission
        ledger entries from the manual purchase deleted by idempotencyKey
        (not userId-only, per the standing rule), sponsor's cached C/A/B/
        SAVING balances recomputed from source, verified via the real
        `runReconciliation()` function returning `clean: true` with zero
        mismatches before considering the manual pass done. Session token
        also deleted. Final full-suite re-run after cleanup: still
        32/32 files, 222/222 tests passing.

## SCRUM-66: wire payDirectCommission into the purchase flow — DONE

- [x] `src/lib/direct-commission.ts`: extracted `payDirectCommissionInTx
      (investmentId, forDate, tx)` — the real transactional body.
      `payDirectCommission` is now a thin wrapper
      (`prisma.$transaction((tx) => payDirectCommissionInTx(...))`), kept
      for SCRUM-65's existing direct-call API/tests, not removed.
- [x] `src/lib/investments.ts`: `purchasePackage` calls
      `payDirectCommissionInTx(investment.id, data.forDate, tx)` right
      after `tx.investment.create(...)`, inside the same transaction —
      only on the newly-created path, not the already-processed replay
      path. Any error inside it propagates through purchasePackage's
      transaction callback and Prisma auto-rolls-back the whole thing; no
      separate try/catch needed.
- [x] Real test-ordering bug found while wiring this in (not a bug in the
      new code): SCRUM-65's "blocks the commission when the buyer is
      suspended" test suspended the buyer *after* calling `makePurchase`
      — harmless before this ticket (nothing auto-triggered commission at
      purchase time), but now that `purchasePackage` pays the commission
      internally, that test's own purchase call paid it while the buyer
      was still active, then suspended the buyer too late. Fixed by
      moving `suspend(buyer.id)` before `makePurchase` and removing the
      now-redundant explicit `payDirectCommission` call — the purchase
      call itself is now the thing under test for that no-op path.
- [x] Two new tests in `direct-commission.test.ts`, new describe block
      `"purchasePackage + payDirectCommission wiring (SCRUM-66)"`:
      - a single `purchasePackage` call (no separate `payDirectCommission`
        call in the test) results in both the investment existing AND the
        sponsor's C/SAVING correctly credited AND a matching saving_lot —
        proving the wiring end-to-end through the real entry point, not
        just through direct-commission's own internal API.
      - forced mid-commission failure: temporarily closes out the active
        `commission_config` row (`effectiveTo` backdated) so
        `payDirectCommissionInTx`'s own config lookup throws partway
        through `purchasePackage`'s transaction; restored in a `finally`
        block regardless of pass/fail (verified directly in the DB
        afterward — never left broken for other tests in this shared dev
        DB). Asserts the whole transaction rolled back atomically: zero
        investment rows, zero purchase ledger entries (the B debit/A
        credit that would otherwise have posted), Wallet B still holds
        its full pre-purchase balance, sponsor's C still zero, zero
        saving_lots — not a half-completed state with the investment
        created but commission silently missing.
- [x] Confirmed Phase 3's existing `investments.test.ts` suite (10 tests)
      passes completely unmodified — those test users are all
      `registerAsRoot` (no sponsor), so `payDirectCommissionInTx`
      correctly no-ops for every one of them, preserving pre-SCRUM-66
      purchase behavior exactly.
- [x] Full suite: 32 files, 215/215 passing (213 prior + 2 new), including
      `reconciliation.test.ts` clean. `tsc --noEmit` clean. Verified zero
      leftover `direct-commission-*` users, zero leftover saving_lots, and
      `commission_config`'s single active row correctly restored
      (`effective_to` null) after the forced-failure test.

Plan:
- [ ] `src/lib/direct-commission.ts`: extract `payDirectCommissionInTx
      (investmentId, forDate, tx: Prisma.TransactionClient)` — the existing
      `payDirectCommission` transactional body, now callable with a
      caller-supplied `tx`. `payDirectCommission` itself becomes a thin
      wrapper: `prisma.$transaction((tx) => payDirectCommissionInTx(...))`
      — kept for SCRUM-65's existing direct-call tests/API, not removed.
- [ ] `src/lib/investments.ts`: `purchasePackage` calls
      `payDirectCommissionInTx(investment.id, data.forDate, tx)` right
      after `tx.investment.create(...)`, inside the same transaction — NOT
      as a separate follow-up call after the transaction commits. Only on
      the newly-created path, not the already-processed replay path (a
      replay's commission was already resolved on the original call).
      Any error thrown inside payDirectCommissionInTx propagates up
      through purchasePackage's transaction callback, which Prisma
      auto-rolls-back — no separate try/catch needed, this is the same
      atomicity mechanism postTransaction itself already relies on.
- [ ] Tests first, extending `direct-commission.test.ts` (not
      investments.test.ts — this is direct-commission's own integration
      surface):
      - a sponsored buyer's first purchase, verified via ONE
        `purchasePackage` call: investment created AND sponsor's C/SAVING
        credited AND saving_lot created, all confirmed after that single
        call returns (no separate payDirectCommission call in the test).
      - a forced failure partway through the commission step (achieved by
        pre-inserting a ledger_entries row that collides with one of
        payDirectCommissionInTx's own idempotency keys, so its internal
        postTransaction call throws on the DB unique constraint) leaves
        NO investment row, NO purchase ledger entries (B debit/A credit),
        and NO commission ledger entries — proving the whole transaction
        rolled back atomically rather than leaving the investment
        half-committed with a missing commission.
- [ ] Confirm Phase 3's existing purchase tests
      (`investments.test.ts`) still pass unmodified — a purchase by a
      root user (no sponsor) must behave identically to before this
      change (this is exactly the "no sponsor -> no-op" path, already
      proven safe by SCRUM-65, but must be re-verified end-to-end through
      purchasePackage itself now that it's wired in).
- [ ] Full suite + `tsc --noEmit` after; re-verify no leftover data.

## SCRUM-68: Phase 6 exit test — RUN AND PASSED

Ran a real scratch script (`.scratch_exit_test_phase6.ts`, deleted after —
matches the Phase 3/5 exit-test convention) directly against the dev
database, using real lib functions (`registerAsRoot`/`registerWithSponsor`,
`adminCreditWalletB`, `purchasePackage`, `payDirectCommission`), not a re-run
of the permanent unit suite. Migration state verified clean first (`prisma
migrate status`). Built a 3-level sponsor chain (grandparent -> sponsor ->
referral) specifically to prove the "one level only" clause for real, not
just infer it from unit tests that never chained three real sponsor levels
together in one scenario.

### Results (18/18 assertions passed)

**Scenario 1 — referral's first $10,000 purchase:**
- Sponsor Wallet C == 500, SAVING == 300 (exact)
- A matching saving_lot exists: amount 300, unlocksAt == purchase date + 3
  months exactly (2026-08-01 -> 2026-11-01)

**Scenario 2 — referral's second purchase ($777, any amount/funding source)
generates no Direct Commission:**
- Zero DIRECT_COMMISSION/DIRECT_SAVING ledger entries reference the second
  investment
- Sponsor's C/SAVING balances unchanged at 500/300
- Still exactly 1 saving_lot for the sponsor (not 2)

**Scenario 3 — the sponsor's own sponsor (grandparent) receives nothing,
one level only:**
- Grandparent Wallet C == 0, SAVING == 0
- Grandparent has zero DIRECT_COMMISSION/DIRECT_SAVING ledger entries at all

**Scenario 4 — replaying with the same idempotency key creates no
duplicate:**
- Direct `payDirectCommission` replay on the same investment: ledger entry
  count unchanged (4 before, 4 after), still exactly 1 saving_lot, sponsor
  balances still exactly 500/300
- End-to-end replay via `purchasePackage` itself with the same
  idempotencyKey: returns the same investment id (not a new one), referral
  still has exactly 2 investments total (not 3)

### Cleanup and regression check
- Script's own cleanup used `cleanupLedgerEntriesForUsers` (idempotencyKey
  -scoped, SYSTEM_EXTERNAL-safe) per the standing structural rule — not
  hand-rolled `userId`-only deletion.
- Verified zero leftover `phase6-exit-*` users in the DB after the script's
  own cleanup ran, before even getting to the full-suite check.
- Scratch script deleted; `git status` confirms no trace.
- Full suite: 32 files, 222/222 passing, including `reconciliation.test.ts`
  (3/3, the whole-database solvency check) explicitly re-run and confirmed
  clean on its own as final proof, not just bundled into the full-run count.

**PHASE 6 EXIT TEST: ALL 4 SCENARIOS / 18 ASSERTIONS PASSED. Full suite
clean, including whole-database reconciliation.**

Phase 6 is complete pending user confirmation in the operation-room chat per
CLAUDE.md's build-order rule.

# Phase 5 — Withdrawals

## SCRUM-55: Friday-only guard (server-side, Asia/Dubai) — DONE

- [x] `src/lib/withdrawal-guard.ts`: `NotFridayError` + `assertFriday(forDate: Date): void`,
      reusing the existing `isFriday` from `src/lib/interest-rate.ts` (already
      timezone-correct and tested) rather than duplicating the Intl.DateTimeFormat
      logic. Takes `forDate` as a param — invariant #4, no `new Date()` inside.
- [x] `src/lib/withdrawal-guard.test.ts`: 5 tests — plain Friday/Thursday, plus
      two UTC/Asia-Dubai boundary-straddling instants (UTC-Thursday-but-
      Dubai-Friday, and UTC-Friday-but-Dubai-Saturday) prove the guard reads
      the business timezone, not server UTC. All pass.
- [x] No new config table / schema change needed — timezone is `config.TIMEZONE`
      deployment config already, not a business rule (invariant #6 n/a here).
- [x] Convention set for reuse: every future self-service/capital-release action
      in this phase calls `assertFriday(new Date())` once at the action boundary
      (the one place `new Date()` is allowed), then threads that same `forDate`
      down. B-exit *submission* uses the guard; B-exit admin approve/reject does
      not (per phase brief — admin can decide any day).
- [x] Found unrelated pre-existing environment issue while verifying: host
      `@prisma/client` was stale (missing `interestRateConfig`/`jobRun`
      models), causing 11 failures across `interest-rate.test.ts` and
      `phase-4-exit-test.test.ts` — same class of issue as the Phase 3 lesson
      (container vs host `node_modules` drift). Fixed with `npx prisma
      generate` on host (and in the `app` container). Not caused by this
      task's change; verified via `tsc --noEmit` that no such error touched
      `withdrawal-guard.ts` before the fix.
- [x] Full suite after fix: 25 files, 159/159 tests passing. `tsc --noEmit`
      clean except 3 pre-existing unrelated errors in `daily-interest.test.ts`
      (a Phase 4 type-narrowing issue on `AccrualResult`, not touched by this
      task).

## SCRUM-56: A->B and C->B self-service transfers — DONE

Confirmed with user: SAVING deduction for C->B uses the real (currently
always-zero) `WalletAccount` SAVING balance now, not a hardcoded zero —
correct today, automatically correct once SCRUM-58 populates it, no
follow-up code change needed.

Plan:
- [ ] Add `WalletTransfer` model to schema.prisma (`wallet_transfers` per
      build_plan.md's data model: id, userId, fromWallet (A|C), amount,
      requestedAt, processedAt, idempotencyKey) + migration. This is a new
      table, doesn't exist yet.
- [ ] `src/lib/withdrawable.ts`:
      - `withdrawableProfitA(userId)`: walletA.balance minus SUM(amount) of
        that user's investments where status = ACTIVE (still-locked
        principal). Never touches capital itself — released investments
        don't count against the deduction since their capital already left
        via a separate CAPITAL_RELEASE flow (SCRUM-57, not this task).
      - `withdrawableC(userId)`: walletC.balance - walletSaving.balance.
      Both recompute from source (wallets + investments tables) every call,
      per lessons.md's "recompute from source, never estimate" cached-balance
      principle — no new cached/derived column.
- [ ] `src/lib/transfers.ts`: `transferAtoB(userId, amount, forDate)` and
      `transferCtoB(userId, amount, forDate)`:
      - `assertFriday(forDate)` first (SCRUM-55 guard)
      - ownership: userId comes from the authenticated session only, never a
        client-supplied target (invariant #9) — enforced by construction,
        no separate check needed since there's no "on behalf of" param
      - suspension check: reject if `user.suspendedAt !== null`
      - validate amount > 0 and amount <= withdrawable (reject otherwise,
        clear error)
      - idempotencyKey: `transfer:{fromWallet}:{userId}:{crypto.randomUUID()}`,
        generated server-side inside transferAtoB/transferCtoB each call
        (confirmed with user). A transfer has no natural dedup key from its
        inputs (unlike interest/purchase) since legitimate repeat withdrawals
        of the same amount are valid — a per-call UUID guarantees every real
        transfer succeeds. This protects the ledger's invariant (every write
        has a unique key + the DB constraint backstop) but is not
        double-click/network-retry safe at the UI layer; note that as a
        follow-up concern for the withdrawal UI task (SCRUM-59-ish), not this
        task's scope.
      - `postTransaction`: DEBIT user's A (or C) / CREDIT user's B, both
        entryType WITHDRAWAL_OUT / WITHDRAWAL_IN as appropriate (reuse
        existing enum values, no new entryType)
      - write a `wallet_transfers` row (requestedAt, processedAt) inside the
        same DB transaction as the ledger post
- [ ] Tests first (`transfers.test.ts`):
      - non-Friday attempt rejected (NotFridayError), no ledger/wallet_transfer
        row written
      - A->B withdraws only the profit portion when capital is still locked
        (seed an ACTIVE investment + accrued interest, assert withdrawable
        excludes principal)
      - amount exceeding withdrawable (non-capital) balance rejected
      - replay with the same idempotency key doesn't double-transfer (balance
        unchanged on 2nd call, wallet_transfers not duplicated)
      - C->B basic case (no SAVING yet, so full C balance withdrawable)
      - suspended user blocked
- [x] Added `WalletTransfer` model (`wallet_transfers`, migration
      `20260817160443_add_wallet_transfers`, applied via `migrate deploy` per
      the standing hand-edited-migration rule) — id, userId, fromWallet
      (A|C), amount, requestedAt, processedAt, unique idempotencyKey.
- [x] `src/lib/withdrawable.ts`: `withdrawableProfitA` (A balance minus
      SUM(amount) of ACTIVE investments) and `withdrawableC` (C balance minus
      live SAVING balance, currently always 0 pre-SCRUM-58 but will
      auto-correct once that lands). Both recompute from source every call,
      never cached.
- [x] `src/lib/transfers.ts`: `transferAtoB`/`transferCtoB`, both:
      `assertFriday(forDate)` -> suspension check -> amount > 0 and <=
      withdrawable -> `postTransaction` (DEBIT source wallet / CREDIT B,
      entryType WITHDRAWAL_OUT/WITHDRAWAL_IN) -> `wallet_transfers` audit
      row, all inside one DB transaction. Idempotency key is a server
      -generated `transfer:{wallet}:{userId}:{uuid}` per call (confirmed with
      user — legitimate repeat withdrawals of the same amount must both
      succeed; double-click/network-retry protection is a UI-layer concern
      for a later task, not this one).
- [x] `src/lib/transfers.test.ts`: 10 tests, all passing — non-Friday
      rejection (both directions), profit-only withdrawal while capital
      locked (withdraws exactly the 200 profit, leaves exactly the 1000
      locked capital untouched), amount-exceeds-withdrawable rejection (both
      directions), CAPITAL_RELEASED investments no longer count as locked,
      suspended-user block, C->B basic case, and two replay-safety tests
      (postTransaction-level: same key twice doesn't double-apply; and
      transferAtoB-level: two distinct legitimate calls each move funds,
      proving they're not being incorrectly deduped against each other).
- [x] Full suite: 26 files, 169/169 passing (159 prior + 10 new). `tsc
      --noEmit`: no new errors. (The 3 pre-existing `daily-interest.test.ts`
      narrowing errors mentioned here were subsequently fixed — see
      lessons.md 2026-08-17 entry — `tsc --noEmit` is now fully clean.)

## SCRUM-57: Wallet B exit ("burn") request + admin approval — DONE

Plan:
- [ ] Add `WithdrawalRequest` model to schema.prisma (`withdrawal_requests`
      per build_plan.md: id, userId, amount, status (PENDING|APPROVED|
      REJECTED), requestedAt, decidedAt, decidedByAdminId, adminComment) +
      migration via `migrate dev --create-only` + `migrate deploy` (standing
      rule, hand-edited migration exists in history).
- [ ] `src/lib/withdrawal-requests.ts`:
      - `submitWithdrawalRequest(userId, amount, forDate)`: assertFriday,
        suspension check, `amount >= config.MIN_WITHDRAWAL` ($50, read from
        existing env config — not hardcoded, matches invariant #6's spirit
        since this is deployment config, same as TIMEZONE), creates a
        PENDING row. No ledger entry yet — money doesn't move at submission.
      - `approveWithdrawalRequest(actingAdminId, requestId)`: permission
        check following the exact `requirePackageManagement`/admin-credit.ts
        pattern (main admin bypasses, else require WITHDRAWAL_APPROVAL
        grant) — no shared generic helper, matches this codebase's existing
        per-module convention. Loads the request, rejects if not PENDING
        (no re-deciding). On approval: `postTransaction` DEBIT user's B /
        CREDIT SYSTEM_EXTERNAL (entryType likely needs a WITHDRAWAL-out type
        — reuse WITHDRAWAL_OUT, tagged referenceType "withdrawal_request"),
        update status -> APPROVED, decidedAt, decidedByAdminId, all in one
        DB transaction. No Friday restriction on admin decision (per brief).
      - `rejectWithdrawalRequest(actingAdminId, requestId, comment)`: same
        permission check. Requires non-empty comment. Updates status ->
        REJECTED, decidedAt, decidedByAdminId, adminComment. No ledger entry,
        Wallet B untouched.
      - Ownership: submit only ever acts on the calling userId (invariant
        #9); approve/reject take a requestId but must load it and act on
        whatever userId is stored on that row — never accept a client
        -supplied userId for the money movement.
      - Idempotency: approve/reject are guarded by the PENDING-only check
        (a second approve call on an already-APPROVED row is rejected, not
        silently reprocessed) rather than a separate idempotency key — no
        replay-of-money-movement risk since the ledger write only happens
        once per request by construction (status transition is the guard).
- [ ] Tests first (`withdrawal-requests.test.ts`):
      - $49 request rejected at submission (no row created)
      - $50 exactly succeeds (boundary, minimum is inclusive per docs)
      - valid request sits PENDING
      - non-Friday submission rejected (NotFridayError)
      - approval by a permitted admin (main admin, and separately a grantee)
        moves the money (B decreases, SYSTEM_EXTERNAL side posted) and sets
        status APPROVED + decidedByAdminId + decidedAt
      - approval by an admin without the grant is rejected, no state change
      - rejection leaves Wallet B untouched, sets status REJECTED +
        adminComment, no ledger entries written
      - rejection without a comment is rejected
      - approving/rejecting an already-decided request is rejected
- [x] Added `WithdrawalRequest` model (`withdrawal_requests`, migration
      `20260817164244_add_withdrawal_requests`, applied via `migrate deploy`
      per the standing hand-edited-migration rule) — status enum
      PENDING/APPROVED/REJECTED, decidedByAdminId FK, adminComment.
- [x] `src/lib/withdrawal-requests.ts`: `submitWithdrawalRequest` (Friday
      guard, suspension check, $50 minimum from `config.MIN_WITHDRAWAL`,
      inclusive — creates PENDING row, no ledger write yet).
      `approveWithdrawalRequest` (permission check matching the codebase's
      existing per-module pattern from admin-credit.ts/packages.ts — no
      Friday restriction, PENDING-only guard, `postTransaction` DEBIT B /
      CREDIT SYSTEM_EXTERNAL tagged to the request, status -> APPROVED).
      `rejectWithdrawalRequest` (same permission check, requires non-empty
      comment, PENDING-only guard, no ledger write, status -> REJECTED).
- [x] `src/lib/withdrawal-requests.test.ts`: 12 tests, all passing — $49
      rejected at submission, $50 exact boundary succeeds, non-Friday
      submission rejected, suspended-user block, approval by main admin
      moves money + updates status, approval by a WITHDRAWAL_APPROVAL
      grantee also works, approval without the grant rejected with no state
      change, admin decision explicitly proven to work on a non-Friday,
      re-approving an already-decided request rejected (no double-burn),
      rejection leaves B untouched + records reason + no ledger entry,
      empty-comment rejection blocked, rejection without the grant blocked.
- [x] Full suite: 27 files, 181/181 passing (169 prior + 12 new). `tsc
      --noEmit`: fully clean, zero errors. No leftover test data (checked
      withdrawal_requests/wallet_transfers counts post-run: 0).

## SCRUM-58: SAVING unlock job — DONE

Confirmed with user: add `source_investment_id` (nullable FK to Investment)
now, matching build_plan.md's documented `saving_lots` schema exactly, even
though nothing populates it until Phase 6 — avoids a second migration later.

Plan:
- [ ] Add `SavingLot` model to schema.prisma (`saving_lots`): id, userId,
      amount, sourceInvestmentId (nullable FK), createdAt, unlocksAt,
      releasedAt (nullable) + migration via `migrate dev --create-only` +
      `migrate deploy`.
- [ ] `src/lib/saving-lots.ts`: `releaseDueSavingLots(asOfDate: Date)` —
      finds every `saving_lots` row where `releasedAt IS NULL AND unlocksAt
      <= asOfDate`, and for each: `postTransaction` DEBIT user's SAVING /
      CREDIT user's C (entryType SAVING_UNLOCK, referenceType "saving_lot",
      referenceId = lot.id), then set `releasedAt = asOfDate`. Idempotency
      key: `saving_unlock:{lot.id}` — one lot can only ever be released
      once, the key doesn't need a date component (unlike daily interest,
      which repeats per day; a lot's release is a one-time event per lot).
      No job_runs wrapper needed — this isn't a periodic "catch up on missed
      calendar days" job like daily interest; it's "find whatever's currently
      due and hasn't been processed", which is naturally idempotent per-row
      via the releasedAt check + the ledger idempotency key as backstop.
      Takes `asOfDate` as a parameter, never calls `new Date()` internally
      (invariant #4).
- [ ] Tests first (`saving-lots.test.ts`):
      - a lot with unlocksAt in the past releases: SAVING decreases, C
        increases by the same amount, releasedAt gets set, ledger entries
        correct and balanced
      - a lot with unlocksAt in the future is left untouched (releasedAt
        stays null, no ledger entries, no balance change)
      - an already-released lot (releasedAt already set) is not reprocessed
        even if called again for a later asOfDate
      - multiple due lots for the same user all release, each with its own
        ledger entries, summing correctly into C
- [x] Added `SavingLot` model (`saving_lots`, migration
      `20260817165508_add_saving_lots`, applied via `migrate deploy`) — id,
      userId, amount, sourceInvestmentId (nullable, unpopulated until Phase
      6), createdAt, unlocksAt, releasedAt (nullable), indexed on
      `(releasedAt, unlocksAt)` for the due-lot query.
- [x] `src/lib/saving-lots.ts`: `releaseDueSavingLots(asOfDate)` — queries
      `releasedAt IS NULL AND unlocksAt <= asOfDate`, for each due lot posts
      `postTransaction` DEBIT SAVING / CREDIT C (entryType SAVING_UNLOCK,
      tagged to the lot) then sets `releasedAt`, all in one DB transaction
      per lot. Idempotency key `saving_unlock:{lotId}` — one-time per lot,
      no job_runs/period wrapper needed (this isn't a "catch up on missed
      calendar days" job like daily interest; a lot is either due-and
      -unreleased or it isn't).
- [x] `src/lib/saving-lots.test.ts`: 4 tests, all passing — a due lot
      releases correctly (SAVING to 0, C credited, releasedAt set, 2 balanced
      ledger entries), a not-yet-due lot is completely untouched, an
      already-released lot is not reprocessed on a later call (proven by C's
      balance staying at its pre-set value, not doubling), multiple due lots
      for the same user each release independently and sum correctly into C
      while a still-future lot in the same batch is left alone.
- [x] Full suite: 28 files, 185/185 passing (181 prior + 4 new). `tsc
      --noEmit`: fully clean. No leftover test data.

## SCRUM-59: Capital release (A->B, principal only) — DONE

Investigated the "stops earning" requirement before implementing: the
catch-up job (`daily-interest-job.ts` line 99-100) already queries only
`status: "ACTIVE"` investments, so a CAPITAL_RELEASED investment is
correctly excluded from the daily batch in production today. BUT
`accrueDailyInterestForInvestment` itself (`daily-interest.ts`) has no
status check inside it — it only checks profitStartsAt/isFriday/suspendedAt.
It's safe today only because its one caller pre-filters by status; the
function doesn't independently enforce the invariant. Fixing this as part of
this task (adding an explicit skip reason inside the accrual function
itself), not treating the job-level filter as sufficient — this is exactly
the kind of thing the task asked to confirm rather than assume.

Plan:
- [ ] `src/lib/daily-interest.ts`: add `"capital_released"` to
      `AccrualSkipReason`, add a check `if (investment.status ===
      "CAPITAL_RELEASED") return { skipped: true, reason:
      "capital_released" }` early in `accrueDailyInterestForInvestment` —
      makes the function itself correct regardless of caller, not reliant on
      the job's pre-filter alone.
- [ ] `src/lib/capital-release.ts`: `releaseCapital(userId, investmentId,
      forDate)`:
      - ownership: load the investment by id, verify `investment.userId ===
        userId` (invariant #9 — reject if it belongs to someone else, don't
        just trust the caller)
      - `assertFriday(forDate)`
      - suspension check
      - reject if `investment.status !== "ACTIVE"` (already released)
      - reject if `forDate < investment.capitalUnlocksAt` (lock not yet
        expired) — inclusive at exactly capitalUnlocksAt, per "release
        exactly at/after the unlock date succeeds"
      - `postTransaction`: DEBIT user's A / CREDIT user's B, amount =
        `investment.amount` (principal only — never touches accrued profit
        sitting in the same A balance), entryType CAPITAL_RELEASE,
        referenceType "investment", referenceId = investment.id.
        Idempotency key: `capital_release:{investmentId}` — one-time per
        investment, same reasoning as saving-lot release (not a repeating
        per-day event).
      - Update investment: status -> CAPITAL_RELEASED, capitalReleasedAt =
        forDate, in the same DB transaction as the ledger post.
- [ ] Tests first (`capital-release.test.ts`):
      - release attempted before capitalUnlocksAt is rejected, investment
        untouched
      - release exactly at capitalUnlocksAt succeeds
      - release moves only the principal, not accrued profit sitting in the
        same A balance (fund A with principal + profit via a real accrual
        call or direct credit, assert only principal amount moves, exact
        profit remainder stays in A)
      - status -> CAPITAL_RELEASED and capitalReleasedAt set correctly
      - a released investment no longer accrues interest on the next
        accrueDailyInterestForInvestment call (call it directly post
        -release, assert skipped/reason capital_released, no ledger entries)
      - non-Friday release attempt rejected
      - re-releasing an already-released investment rejected
      - ownership: releasing another user's investment rejected
- [x] Fixed the confirmed gap: added `"capital_released"` to
      `AccrualSkipReason` and an explicit `investment.status ===
      "CAPITAL_RELEASED"` check at the top of
      `accrueDailyInterestForInvestment` itself (`daily-interest.ts`) — the
      function now independently enforces "stops earning" rather than
      relying solely on the daily catch-up job's `status: "ACTIVE"`
      pre-filter (which was already correct, but was the only thing
      enforcing the invariant before this fix).
- [x] `src/lib/capital-release.ts`: `releaseCapital(userId, investmentId,
      forDate)` — ownership check (`InvestmentNotOwnedError`), Friday guard,
      suspension check, already-released check (`CapitalAlreadyReleasedError`),
      lock-not-expired check (`CapitalStillLockedError`, inclusive at exactly
      `capitalUnlocksAt`), `postTransaction` DEBIT A / CREDIT B for
      `investment.amount` only (entryType CAPITAL_RELEASE), status ->
      CAPITAL_RELEASED + capitalReleasedAt set, all atomic. Idempotency key
      `capital_release:{investmentId}` (one-time per investment); a genuine
      replay is actually blocked earlier by the already-released check, so
      the key is a backstop, not the primary guard.
- [x] `src/lib/capital-release.test.ts`: 7 tests, all passing — rejected
      before lock expiry (investment/wallets untouched), succeeds exactly at
      the unlock instant, succeeds after it, principal-only proven directly
      (funded A with 1000 principal + 150 profit in the same balance,
      release moves exactly 1000 leaving 150 in A), a released investment's
      next `accrueDailyInterestForInvestment` call returns
      `skipped/capital_released` with zero new ledger entries, non-Friday
      rejected, re-release of an already-released investment rejected (no
      double-move, still exactly 2 CAPITAL_RELEASE entries), releasing
      another user's investment rejected.
- [x] Full suite: 29 files, 192/192 passing (185 prior + 7 new
      capital-release tests; the 6 pre-existing daily-interest.test.ts tests
      also re-verified green with the new status check added). `tsc
      --noEmit`: fully clean. No leftover test data.

## SCRUM-61: Withdrawal UI — DONE

Added shadcn `input`, `label`, `tabs` components (none existed yet — every
prior form in the app so far was buttons-only, this is the first page
needing a text input).

Reviewed existing Phase 3 patterns before building (packages/investments
pages) to reuse rather than reinvent:
- Server component reads data fresh per render; server action calls
  `revalidatePath` on success so the already-mounted client re-renders with
  fresh props (no manual reload) — same pattern for every mutation here.
- Confirmation dialog pattern from `package-grid.tsx` (open -> confirm ->
  success/error states, `isPending` disables buttons during the transition).
- `flex flex-row items-center gap-2` for every icon+text pairing; no
  physical `left-*`/`right-*` classes anywhere (lessons.md RTL entries).
- Card grid pattern (`shadow-sm hover:shadow-md`, `flex flex-col
  justify-between`) from investment-list.tsx for the capital-release-per
  -investment cards.
- Empty state pattern (icon + title + description, dashed border) reused
  for "no B-exit requests yet".

Plan:
- [ ] `src/lib/next-friday.ts`: `daysUntilNextFriday(now: Date): number` —
      pure function, explicit `now` param (invariant #4 discipline even for
      display code, matches `daysUntil` in investments.ts). Returns 0 if
      `now` is already Friday (Asia/Dubai), otherwise days remaining. Small
      unit test alongside (`next-friday.test.ts`) covering a few weekdays
      and the Friday-itself case, plus the UTC/Dubai boundary case from the
      withdrawal-guard tests (reused dates).
- [ ] `src/lib/withdrawal-requests.ts`: add
      `listWithdrawalRequestsForUser(userId)` — user's own requests, newest
      first, ownership enforced by construction (same pattern as
      `listInvestmentsForUser`). Needed for the status list; doesn't exist
      yet.
- [ ] New route `src/app/[locale]/withdrawals/page.tsx` (server component,
      `requireSession`-protected):
      - reads: wallet A/B/C/SAVING balances, withdrawableProfitA,
        withdrawableC, user's investments (for capital-release cards, only
        ACTIVE ones with capitalUnlocksAt info), user's withdrawal requests
        (listWithdrawalRequestsForUser), `daysUntilNextFriday(new Date())`,
        `isFriday(new Date())`
      - passes all as props to client components below
- [ ] `withdrawal-actions.ts` ("use server"): thin action wrappers mirroring
      `packages/actions.ts`'s pattern exactly —
      `transferAtoBAction`/`transferCtoBAction`/`releaseCapitalAction`/
      `submitWithdrawalRequestAction`, each: `requireSession` for the
      userId (never client-supplied), call the corresponding lib function
      with `new Date()`, `revalidatePath` on success, map thrown error
      classes to translated error keys (NotFridayError,
      InsufficientWithdrawableBalanceError, AccountSuspendedError,
      BelowMinimumWithdrawalError, CapitalStillLockedError,
      CapitalAlreadyReleasedError, generic fallback).
- [ ] `transfer-panel.tsx` (client component): A->B and C->B as two cards
      (or tabs — deciding at build time based on how it reads) each showing
      withdrawable amount, an amount input (client-side validation: numeric,
      > 0, <= withdrawable shown inline, $ handled via toDisplay), submit
      button. Disabled with a countdown message when non-Friday
      (`daysUntilNextFriday`), matching the "disabled state with countdown"
      requirement literally — not just a disabled button with no
      explanation. Confirmation dialog before submit (frontend-design rule
      6: every financial action needs a confirm step with concrete amount
      shown) — reuses the Dialog primitive and success/error state pattern
      from package-grid.tsx.
- [ ] `capital-release-panel.tsx` (client component): one card per ACTIVE
      investment showing package name, principal amount, capital-unlock
      countdown/status (reusing the exact display logic already in
      investment-list.tsx), and a release button — disabled if either not
      yet unlocked OR non-Friday, with the specific reason shown (two
      different disabled reasons, must be visually distinguishable, not a
      single generic "unavailable"). Confirmation dialog before release.
- [ ] `b-exit-form.tsx` (client component): amount input with $50 minimum
      enforced client-side (inline validation message, matching
      frontend-design rule 6 — server-side via BelowMinimumWithdrawalError
      is the real guard per the task's own framing), Friday-disabled state
      with countdown, confirmation dialog, submits via
      submitWithdrawalRequestAction.
- [ ] `b-exit-status-list.tsx`: past requests, newest first, status badge
      (PENDING=amber/warning, APPROVED=success green, REJECTED=destructive
      red — new 3-way status color mapping, consistent with the existing
      Active/Capital-released 2-way mapping's spirit but its own set since
      these are different semantics). Shows amount, requestedAt
      (formatDate), and for decided ones: decidedAt + adminComment if
      rejected. Empty state if no requests yet.
- [ ] `loading.tsx` skeleton matching the page's card/list shapes.
- [ ] i18n: new `Withdrawals` namespace in both messages/en.json and
      messages/ar.json in this commit. Wallet A/B/C/SAVING stay English
      (glossary rule); everything else translated, including correct
      Arabic ICU plural categories for day-count strings (matches the
      Investments namespace's existing pattern).
- [ ] RTL-specific pass per lessons.md's two dedicated entries: every
      icon+text pair gets explicit `flex flex-row items-center gap-2`; grep
      new files for physical `left-*`/`right-*`/`ml-*`/`mr-*`/`pl-*`/`pr-*`/
      `text-left`/`text-right` before considering done; any
      absolutely-positioned corner element (if any) uses logical
      `start-*`/`end-*`.
- [ ] Manual verification in the running dev container: exercise A->B,
      C->B, capital release, and B-exit submission against a real test user
      on both a fabricated-Friday and non-Friday state if feasible (or at
      minimum verify the disabled/countdown states render correctly on
      today's real weekday), in both `/en/withdrawals` and `/ar/withdrawals`
      — check RTL layout specifically on the status badges and confirmation
      dialogs per the recurring lesson category.
- [x] Built everything per the plan: `src/lib/next-friday.ts`
      (`daysUntilNextFriday`, 6 tests incl. UTC/Dubai boundary cases),
      `listWithdrawalRequestsForUser` added to withdrawal-requests.ts,
      `src/app/[locale]/withdrawals/{page.tsx, actions.ts, transfer-panel.tsx,
      capital-release-panel.tsx, b-exit-form.tsx, b-exit-status-list.tsx,
      loading.tsx}`. Full `Withdrawals` i18n namespace added to both
      messages/en.json and messages/ar.json (Wallet A/B/C/SAVING kept
      English per glossary; Arabic Friday-countdown string uses full ICU
      plural categories zero/one/two/few/many/other, matching the
      Investments namespace's existing pattern).
- [x] A->B/C->B built as two side-by-side cards (confirmed with user, not
      tabs) inside one grid.
- [x] `tsc --noEmit`: fully clean. Full suite: 30 files, 198/198 passing
      (192 prior + 6 new next-friday tests).
- [x] Manual verification against the real running dev container (not just
      unit tests) as `browser-test@test.local`:
      - `/en/withdrawals`: 200, correct wallet balances (A 6300.00, B
        500.00, C 6500.00 — real data, no placeholder/test junk visible),
        Friday countdown correctly reads "4 days remaining" (today is a
        real Monday in Asia/Dubai, confirmed via `TZ=Asia/Dubai date`
        against the running container's actual clock — 4 days to Friday is
        exactly right), capital-release cards correctly show "still within
        the 6-month lock" for both real investments (unlocksAt Feb 2027),
        B-exit empty state renders correctly (no requests yet for this
        user), all buttons correctly disabled server-side via `isFriday:
        false` prop (confirmed in the RSC payload, not just visually).
      - `/ar/withdrawals`: 200, `dir="rtl"` present, every string correctly
        translated, Wallet A/B/C stayed English per the glossary rule,
        Friday countdown correctly rendered "4 أيام متبقية" (the Arabic
        "few" plural category for 4 — proves the ICU categories are wired
        correctly, not just present in the JSON), numerals stayed Western
        (0.00/100.00/etc, never Eastern Arabic digits).
      - No runtime errors/warnings in the app container logs across either
        request.
      - Root cause of an initial 404: the dev container's file watcher
        hadn't picked up the newly-created route directory; `docker compose
        restart app` resolved it (consistent with this project's known
        Windows-bind-mount dev quirks, not a code defect — confirmed by the
        page working immediately post-restart with zero code changes).
- [x] RTL pass: grepped all new files for physical
      left-*/right-*/ml-*/mr-*/pl-*/pr-*/text-left/text-right — zero
      matches. Every icon+text pairing (Friday-countdown clock icon, lock
      icon, success checkmark, empty-state icons) uses explicit `flex
      flex-row items-center gap-2`, matching the two dedicated lessons.md
      RTL entries from Phase 3.
- [x] Reused established patterns throughout rather than reinventing:
      confirm-dialog open/success/error state machine and `revalidatePath`
      -on-success from packages/actions.ts + package-grid.tsx; card grid and
      empty-state visuals from investment-list.tsx; `formatDate`/`toDisplay`
      from display.ts unchanged.
- [x] Added shadcn `input`, `label`, `tabs` components (first form input in
      the app; `tabs` pulled in but unused after choosing the two-card
      layout — left in place since it's a standard shadcn primitive other
      future screens will likely need, not dead app code).

## SCRUM-62: Phase 5 exit test — RUN AND PASSED

Ran a real scratch script (`.scratch_exit_test_phase5.ts`, deleted after —
matches the Phase 3 exit-test convention) directly against the dev database,
using real lib functions (`transferAtoB`/`transferCtoB`, `submitWithdrawalRequest`/
`approveWithdrawalRequest`/`rejectWithdrawalRequest`, `releaseCapital`,
`accrueDailyInterestForInvestment`), not a re-run of the permanent unit
suite. Migration state verified clean first (`prisma migrate status`).

One exit-test clause — "their leg's active status flips to inactive for
their upline" — depends on `binary_nodes`/leg-active-status tracking, which
is Phase 8 work and does not exist in the schema or codebase yet (confirmed
via grep before running). Marked N/A per the user's direction, not silently
dropped or fabricated.

### Results (29/29 testable assertions passed, 1 clause correctly N/A)

**Scenario 1 — A->B and C->B, Friday vs non-Friday:**
- Both rejected on a real Thursday (`NotFridayError`), Wallet A untouched
- Both succeed instantly on a real Friday with no approval step
- Wallet A left with exactly the locked capital (1000) after the 200 profit
  moved out; Wallet C fully drained; Wallet B received both (350 total)

**Scenario 2 — $200 B-exit request, PENDING -> admin approval:**
- Sits PENDING after submission, Wallet B untouched while pending, no
  SYSTEM_EXTERNAL entry exists yet
- Main admin approval (on a non-Friday Monday, confirming admin decisions
  aren't Friday-restricted) flips status to APPROVED, Wallet B decreases by
  exactly 200, SYSTEM_EXTERNAL reflects the burned amount

**Scenario 3 — rejected B-exit request:**
- Status REJECTED, reason recorded, Wallet B completely untouched, zero
  ledger entries written

**Scenario 4 — $49 B-exit request:**
- Rejected at submission (`BelowMinimumWithdrawalError`), no request row
  created at all

**Scenario 5 — capital release, month 5 vs month 6:**
- Constructed a real Friday attempt genuinely before a 6-month unlock
  (purchased 2026-03-21, unlocks 2026-09-21, attempted 2026-08-21 — a real
  Friday, isolating the capital-lock check from the Friday guard) —
  correctly blocked with `CapitalStillLockedError`
- A second investment constructed so its exact 6-month unlock date IS a
  real Friday (purchased 2026-02-21 -> unlocks 2026-08-21) — release
  allowed exactly at that instant, status -> CAPITAL_RELEASED,
  capitalReleasedAt recorded correctly
- Caught and fixed one bug in the test itself before this passed: the first
  draft's month-5 date math accidentally substituted a later date whenever
  the naive month-5 mark fell before the fabricated Friday, silently testing
  "well past unlock" instead of "still locked" — caught because the
  assertion still failed, not silently passed; rewritten with an explicit
  test-setup assertion (`FRIDAY < capitalUnlocksAtMonth5Case`) proving the
  scenario actually tests what it claims to before checking the real
  assertion.

**Scenario 6 — suspended user, zero interest the day after suspension:**
- Investment purchased 2026-08-01, user suspended 2026-08-15, accrual
  attempted 2026-08-16 (a non-Friday) — skipped with reason
  `owner_suspended`, zero DAILY_INTEREST ledger entries, Wallet A balance
  stayed at its unfunded 0 (never funded, so zero credited is unambiguous)

**Scenario 7 — leg-active-status for upline: N/A, Phase 8 not built yet.**

### Cleanup and regression check
- Verified zero orphaned rows in the tables directly scoped by `userId`
  (test users, packages, investments all counted 0 by their distinguishing
  markers) — this check alone was **not sufficient**, see below.
- Scratch script deleted; `git status` confirms no trace.
- First full-suite run after the exit test caught a real bug: my own exit
  -test script's cleanup deleted ledger rows via `where: { userId: { in:
  createdUserIds } } }`, which misses the paired `SYSTEM_EXTERNAL` row
  (`userId: null`) from every `postTransaction` call — the exact mistake
  already flagged twice in lessons.md's Phase 2 entries, now a third time.
  `reconciliation.test.ts` failed with a real -8700 global-solvency drift.
  Diagnosed by finding every SYSTEM_EXTERNAL ledger row with no surviving
  idempotencyKey-sibling (16 orphans, all traced to this session's own
  `phase5-exit-fund:*`/`withdrawal_request_approval:*` calls — confirmed
  self-inflicted, not pre-existing). Repaired via the standard
  recompute-from-source principle: deleted exactly those 16 orphaned rows
  (found by idempotencyKey lookup, not guessed), re-verified via the real
  `runReconciliation()` function, then re-ran the full suite as final
  proof — see lessons.md's new entry for the full writeup and standing rule.
- Second (post-fix) full suite: 30 files, 198/198 passing, including
  `reconciliation.test.ts` clean. No regressions from this session's other
  work (config.ts lazy-Proxy rewrite, session.ts Secure-flag fix,
  daily-interest.ts capital_released check, all of SCRUM-56/57/58/59/61).

**PHASE 5 EXIT TEST: ALL TESTABLE CRITERIA PASSED (29/29); ONE CLAUSE
CORRECTLY N/A PENDING PHASE 8. Full suite clean, including whole-database
reconciliation, after fixing a real cleanup bug the exit test's own
assertions did not catch.**

Phase 5 is complete pending user confirmation in the operation-room chat per
CLAUDE.md's build-order rule.

## Post-SCRUM-62 follow-up: shared test-cleanup helper (structural fix)

User asked, after the third occurrence of the SYSTEM_EXTERNAL orphan
mistake, whether it could be made structurally harder to get wrong rather
than relying on remembering the rule each time — requested before closing
Phase 5, since Phase 6+ keeps writing tests that touch SYSTEM_EXTERNAL.

- [x] Investigated existing cleanup patterns across all 30 test files first.
      Found every file already *tried* to be correct via a hand-maintained
      `createdEntryIds` array pushed after each transaction call — the
      3 real incidents all happened at a call site that skipped this
      manual step, not because the pattern was unknown.
- [x] Designed `cleanupLedgerEntriesForUsers(userIds: string[])` in new
      `src/lib/test-helpers.ts` — takes only the user-id array every test
      already reliably tracks (that part has never failed), looks up every
      ledger entry belonging to those users, collects the distinct
      idempotencyKeys, deletes every row sharing those keys (any userId,
      including null) in one call. Structurally includes SYSTEM_EXTERNAL
      siblings by construction — no per-call-site array-pushing discipline
      required at all, unlike the old pattern.
      Considered and rejected an idempotencyKey-array version instead
      (confirmed with user): several production functions
      (`transferAtoB`, etc.) generate their key internally via
      `randomUUID()`, so a test can't always capture it in advance — same
      discipline gap as the bug being fixed.
- [x] `src/lib/test-helpers.test.ts`: 5 tests — deletes both sides of a
      pair including SYSTEM_EXTERNAL, leaves other users' entries
      untouched, handles a >2-entry transaction (not just a simple pair),
      no-op for an empty list, no-op for a user with no entries.
- [x] Migrated every test file with the risky `userId`-only ledger-cleanup
      pattern to the new helper, removing the manual `createdEntryIds`
      tracking entirely: `admin-credit.test.ts`, `transfers.test.ts`,
      `withdrawal-requests.test.ts`, `capital-release.test.ts`,
      `saving-lots.test.ts`, `reconciliation.test.ts`,
      `ledger-transaction.test.ts`, `investments.test.ts`. Deliberately
      did NOT touch `daily-interest.test.ts`/`daily-interest-job.test.ts`
      — those already scope cleanup by `referenceType`/`referenceId`
      (investment id), a different but equally correct strategy for
      DAILY_INTEREST's specific pairing, not the bug class being fixed;
      migrating them would be unnecessary churn on already-correct code.
- [x] `tsc --noEmit` clean after every migration (confirms no dead
      `createdEntryIds` variables or now-unused `entries`/`rows` bindings
      left behind).
- [x] Full suite: 31 files, 203/203 passing (198 prior + 5 new
      `test-helpers.test.ts`), including `reconciliation.test.ts` — the
      exact whole-database check that caught the original bug — still
      clean. Re-verified drift is 0 via a direct DB query as final proof.
- [x] Logged in lessons.md as an addendum to the SCRUM-62 entry: this is
      now the standing pattern for any future test/script touching
      ledger_entries, not just a fix for the three past incidents.
