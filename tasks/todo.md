# Phase 3 — Packages & Purchase

## SCRUM-40, 41, 42, 43, 45 — DONE (see git history / prior sessions)

## SCRUM-46: "My investments" view — DONE (confirmed by user, incl. spacing fix)

Plan:
- [ ] `src/lib/investments.ts`: add `listInvestmentsForUser(userId)` — fetch
      the user's investments with their package (name), ordered newest-first.
      Read-only, no ownership param beyond userId itself (ownership enforced
      by construction, same pattern as purchasePackage — no target-user param
      exists at all).
- [ ] Countdown logic: a small pure function `daysUntil(target, now)` —
      explicit `now` param (invariant #4 discipline even for display code),
      returns 0 or negative once passed (means "unlocked"/"started").
      Add a small unit test for this pure function specifically since it has
      actual logic (day rounding), unlike the page/component wiring.
- [ ] Route: `src/app/[locale]/investments/page.tsx` (server component,
      `requireSession`-protected, same pattern as the packages page)
- [ ] `investment-list.tsx`: card list, each card shows:
      - package name (English, glossary rule)
      - amount (tabular-nums, toDisplay)
      - purchase date (Intl.DateTimeFormat, Asia/Dubai timezone, Western
        numerals forced in Arabic via `ar-u-nu-latn`)
      - profit-start countdown: "starts in N days" / "profit accruing" once
        past profitStartsAt
      - capital-unlock countdown: "unlocks in N days" / "unlocked" once past
        capitalUnlocksAt, with capitalReleasedAt/status handled too
      - status badge (ACTIVE / CAPITAL_RELEASED) using shadcn Badge, with a
        consistent color mapping (this is the first status badge in the
        app — establish the mapping here for reuse later: active=neutral or
        primary-tinted, released=muted/gray)
- [ ] Empty state: no investments yet, message + CTA link to the packages
      page (reuse the frontend-design empty-state pattern from SCRUM-45:
      icon + message, not just blank)
- [ ] Loading state: `loading.tsx` skeleton matching the card list shape
- [ ] RTL-specific attention per lessons.md's two new entries:
      - any icon+text pair (lock icon next to countdown text, badge icon if
        any) gets explicit `flex flex-row items-center gap-2`
      - no physical `left-*`/`right-*`/`ml-*`/`mr-*`/`pl-*`/`pr-*`/
        `text-left`/`text-right` anywhere in new markup — logical only
      - if any dismiss/close affordance is added anywhere on this page,
        it must use logical `start-*`/`end-*` positioning, not physical
- [ ] i18n: new `Investments` namespace in both messages/en.json and
      messages/ar.json in this commit — package names/Wallet terms stay
      English, everything else translated
- [ ] Manual verification: use existing `browser-test@test.local` test user
      (has at least one investment from prior purchase testing) — verify in
      both `/en/investments` and `/ar/investments`, check RTL icon/badge
      layout specifically given the two recent bugs
- [x] Added `listInvestmentsForUser(userId)` and `daysUntil(target, now)` to
      `src/lib/investments.ts`. 10 tests written first/alongside
      (investments.test.ts: 4 for daysUntil, 2 for listInvestmentsForUser)
      plus 3 more for a new `formatDate` display helper (display.test.ts) —
      140/140 total suite tests passing.
- [x] Added `formatDate(date, locale)` to `src/lib/display.ts` — Asia/Dubai
      timezone, forces Western numerals in Arabic via `ar-u-nu-latn`.
- [x] Built `src/app/[locale]/investments/page.tsx` (server component,
      `requireSession`-protected), `investment-list.tsx` (server component —
      no interactivity needed here, so no "use client"), `loading.tsx`
      (skeleton matching card shape).
- [x] Cards show package name, status badge (default=Active/primary blue,
      secondary=Capital released/muted gray — first status-color mapping in
      the app, documented here for reuse), amount, purchase date, and both
      countdowns (profit-start +7d, capital-unlock +6mo) with "N days
      remaining" / "started"/"unlocked" text once passed.
- [x] Empty state: icon + title + description + "Browse packages" CTA
      linking to `/packages` (via next-intl's `Link`, base-ui's `render`
      prop pattern — not shadcn's usual `asChild`, this component library
      uses `render={<Link .../>}` instead).
- [x] i18n: `Investments` namespace added to both messages/en.json and
      messages/ar.json, including correct Arabic ICU plural categories
      (zero/one/two/few/many/other) for the day-count strings, not just
      English's one/other.
- [x] RTL safety checked explicitly per the two new lessons.md entries: grepped
      new files for any physical left-*/right-*/ml-*/mr-*/pl-*/pr-*/text-left/
      text-right — none found; status badge sits in an explicit
      `flex flex-row items-center justify-between gap-2` header row, not
      relying on default block flow.
- [x] Manual verification via the running dev container (real browser
      confirmation still to come from user): logged in as
      `browser-test@test.local`, confirmed 200 + correct translated content
      on both `/en/investments` and `/ar/investments`, `dir="rtl"` present.
      Trimmed that user's 13 accumulated test investments down to 2
      representative ones (with user's confirmation) so the reviewed screen
      isn't cluttered with test-purchase noise.
- [x] Full suite re-run: 20 files, 140 tests passing, no regressions.
      `npx tsc --noEmit` clean.
- [x] Bug fix after user's live review: profit-start/capital-unlock rows in
      `investment-list.tsx` had `justify-between` with no `gap`, so label and
      value could sit with no minimum spacing depending on container width —
      added `gap-2` to both rows. Direction-agnostic fix (flex `gap` doesn't
      care about LTR/RTL), verified in both `/en` and `/ar`.

## SCRUM-47: Phase 3 exit test — RUN AND PASSED

Ran a real scratch script (`.scratch_exit_test_phase3.ts`, deleted after)
directly against the dev database — not a re-run of the permanent unit
suite, which already covers each piece individually. Migration state
verified clean first (`prisma migrate status`: 14/14 applied) per the
standing lessons.md check.

### Results (17/17 assertions passed)

**Scenario 1 — exact-balance purchase of the $1,000 (Silver) package:**
- Wallet B: 0 after purchase (was 1000)
- Wallet A: 1000 after purchase (was 0)
- `purchasedAt` = 2026-08-16T09:00:00.000Z (as given)
- `profitStartsAt` = 2026-08-23T09:00:00.000Z — exactly +7 days
- `capitalUnlocksAt` = 2027-02-16T09:00:00.000Z — exactly +6 months
- status = ACTIVE, `capitalReleasedAt` = null

**Scenario 2 — insufficient funds:**
- User funded with 500, attempted to buy the 1000 Silver package
- Rejected: "Insufficient Wallet B balance for this purchase."
- 0 ledger entries written, 0 investment rows created, Wallet B unchanged at 500

**Scenario 3 — deactivated package:**
- Purchased a test package while active (investment created successfully,
  amount 250)
- Package appeared in `listPurchasablePackages()` before deactivation
- After `deactivatePackage`: package no longer appears in the purchasable
  list; a fresh purchase attempt against it is rejected ("This package is
  deactivated and cannot be purchased.")
- The investment made **before** deactivation is untouched: still ACTIVE,
  amount still 250, still references the now-deactivated package

### Cleanup and regression check
- Verified zero orphaned rows post-cleanup (ledger entries by comment match,
  leftover test packages, leftover test users — all 0)
- Full suite re-run after the exit test: 20 files, 140 tests passing, no
  interference/regressions

**PHASE 3 EXIT TEST: ALL CRITERIA PASSED.**

Phase 3 is complete pending user confirmation in the operation-room chat per
CLAUDE.md's build-order rule (a phase doesn't start until the previous
phase's exit test has passed AND been confirmed by the user).
