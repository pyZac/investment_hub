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
