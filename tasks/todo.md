# Session: Ranking page + Marketer role split

## Investigation notes
- `RankProgressPanel` (src/components/rank-progress-panel.tsx) + `getRankProgressForUser`
  (src/lib/rank.ts) already exist and are reused as-is for the current-rank/progress part.
- No existing ungated "list all active ranks" reader — `listRankConfigs` is
  RANK_CONFIG-permission-gated (admin only). Need a NEW ungated reader
  (`listActiveRankLadder()`, session-only) for the public rank ladder table.
- `adminCreateUser` lives in `src/lib/users.ts` (not user-management.ts).
- `getUserDetail` lives in `src/lib/user-management.ts`.
- No `MARKETER_STATUS_CHANGED`-equivalent AdminActionType exists — following the
  USER_SUSPENDED/USER_REINSTATED convention, add one (new migration).
- Confirmed with user: Binary Tree / Referrals / Ranking gated at BOTH nav visibility
  AND page level (redirect non-marketers to /dashboard), not just nav.
- `validateAndTouchSession` already does `include: { user: true }` — once `isMarketer`
  is on the schema, it's available on `sessionUser` in `(app)/layout.tsx` with zero
  query changes.

## Step 1 — Schema migration
- [ ] Add `isMarketer Boolean @default(false) @map("is_marketer")` to `User` model.
- [ ] Add `MARKETER_STATUS_CHANGED` to `AdminActionType` enum.
- [ ] `npx prisma migrate dev` — READ the generated SQL in full before trusting it
      (lessons.md: the EMAIL_CHANGED migration silently included an unrelated FK
      change last time; verify this one is additive-only).

## Step 2 — Backend (Feature 2)
- [ ] `src/lib/users.ts`: `adminCreateUserInputSchema` gets `isMarketer:
      z.boolean().optional().default(false)`; `adminCreateUser` writes it to
      `tx.user.create`.
- [ ] New `toggleMarketerStatus(actingAdminId, targetUserId, forDate)` in users.ts —
      USER_MANAGEMENT-gated (same assertHasUserManagementPermission pattern), flips
      the boolean, logs an admin_actions row (MARKETER_STATUS_CHANGED). No "reason"
      required (matches feature ask — a toggle button, not a reason-gated action like
      suspend); confirm this is fine since suspend/reinstate both require reasons but
      this is a lower-stakes, reversible UI flag, not a financial freeze.
- [ ] `src/lib/user-management.ts`: `getUserDetail` select + return adds `isMarketer`.
- [ ] `src/lib/rank.ts`: new `listActiveRankLadder()` — session-only (no permission
      gate), returns id/rankName/mrvRequired/directReferralsRequired/rewardAmount/
      rewardType/rankOrder for every `effectiveTo: null` row, ordered by rankOrder.
      Deliberately excludes achievedByAnyUser/setByAdminName (admin-only fields).

## Step 3 — Admin UI (Feature 2)
- [ ] `create-user-form.tsx`: add "Marketer account" checkbox, wired into
      createUserAction's input.
- [ ] `actions.ts` (admin/users): thread `isMarketer` through `createUserAction`'s
      input type; add `toggleMarketerStatusAction`.
- [ ] `user-detail-panel.tsx`: add isMarketer to the Detail type; add "Enable/Disable
      marketing features" button next to suspend/reinstate, calling the new action,
      optimistic-refetch like the existing suspend/reinstate flow (no confirm dialog —
      matches "toggle button" wording, not a destructive/reason-gated action).
- [ ] Translations (AdminUsers namespace, EN+AR): marketerAccountLabel ("Marketer
      account" / "حساب مسوّق"), enableMarketing ("Enable marketing features" /
      "تفعيل ميزات التسويق"), disableMarketing ("Disable marketing features" /
      "تعطيل ميزات التسويق"), plus a marketer status label/badge for the detail view.

## Step 4 — Ranking page (Feature 1)
- [ ] New `src/app/[locale]/(app)/ranking/page.tsx` — requireMarketerOrRedirect,
      renders RankProgressPanel (existing, reused as-is) + a new rank-ladder table/grid
      component consuming listActiveRankLadder().
- [ ] New `rank-ladder.tsx` component — simple table/grid, each row: rank name, MRV
      threshold, referral threshold, reward amount + type. Follows frontend-design
      skill (real elevation, not bare rows) and bilingual-rtl (reward amounts stay
      tabular-nums, rank names are domain terms so stay English-styled per the
      glossary rule already established elsewhere, e.g. investment-related labels).
- [ ] `page-guard.ts`: new `requireMarketerOrRedirect` helper (403-style redirect to
      /dashboard if `!user.isMarketer`), mirroring requireMainAdminOrRedirect's shape.
- [ ] Apply requireMarketerOrRedirect to binary-tree/page.tsx and referrals/page.tsx
      too (currently plain requireSessionOrRedirect) — confirmed in scope per user's
      answer to the gating question.
- [ ] Translations: new `Ranking` namespace (pageTitle/pageDescription/ladder column
      headers) EN+AR.

## Step 5 — Nav changes
- [ ] `(app)/layout.tsx`: pass `isMarketer={sessionUser?.isMarketer ?? false}` to
      DashboardNav alongside isAdmin.
- [ ] `dashboard-nav.tsx`: split NAV_ITEMS into always-visible
      (dashboard/invest/withdrawals/transactions/profile) and marketer-only
      (binaryTree/referrals/ranking — note referrals+ranking are NEW additions to the
      marketer set per spec, binaryTree already existed). Add Ranking nav item
      (Trophy icon, matches existing convention from rank-progress-panel/admin
      sidebar).

## Step 6 — Tests
- [ ] users.test.ts / user-management.test.ts (wherever fits existing file split):
      adminCreateUser with isMarketer true/false (default), toggleMarketerStatus
      (flips both directions, logs admin_actions row, permission-gated, non-main-admin
      without USER_MANAGEMENT rejected).
- [ ] rank.test.ts (or wherever rank tests live): listActiveRankLadder returns only
      active (effectiveTo: null) ranks, ordered by rankOrder, no admin-only fields
      leaked, no permission gate (any session works).

## Step 7 — Verification
- [ ] tsc --noEmit clean.
- [ ] Full test suite (background, sequential).
- [ ] Manual: log in as a non-marketer regular user — confirm nav shows only 5 tabs,
      confirm direct URL to /ranking, /binary-tree, /referrals redirects to /dashboard.
      Toggle a user to marketer via admin panel, confirm nav updates on next login/
      revalidation, ranking page renders ladder + progress panel correctly. EN + AR
      screenshots, RTL check on ranking page and the new admin checkbox/toggle button.

## Step 8 — Commit + push
- [ ] Exclude docker-compose.yml (standing instruction).
