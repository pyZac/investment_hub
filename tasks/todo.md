# Session: Replace raw Investment ID input with user-search -> investment-pick flow

Scope: UI/UX-only change to the "Simulate Daily Interest" section on
/admin/developer-tools. Investment ID field disappears entirely from the
UI; the underlying simulateDailyInterestAction/simulateDailyInterestDays
still take an investmentId internally — unchanged, no backend simulation
logic touched.

## Key finding before writing code
`listInvestmentsForUser`/`listActiveInvestmentsForUser` in investments.ts
are deliberately SELF-SERVICE only (own doc comment: "ownership enforced
by construction... no separate target-user param exists to view someone
else's investments, invariant #9"). Calling either with an admin-supplied
target user id would be exactly the IDOR bypass invariant #9 exists to
prevent — these are NOT the right functions to reuse here, even though
their query shape is what I need. Need a new, explicitly admin-gated
function instead, matching getUserDetail's established shape
(actingAdminId + targetUserId params, permission-checked first, queries
prisma directly rather than delegating to the self-service function).

Also: `searchUsers` (user-management.ts) is gated by
`assertHasUserManagementOrCreditIssuancePermission`, which allows
USER_MANAGEMENT, CREDIT_ISSUANCE, MANUAL_ADJUSTMENT, LEDGER_VIEW, or
SECURITY_VIEW — NOT DEVELOPER_TOOLS. A sub-admin could hold
DEVELOPER_TOOLS without any of those five. Extending that permission set
to include DEVELOPER_TOOLS (same "any one of these grants is sufficient
to search" reasoning already documented on that function) is the
consistent fix — not writing a second, duplicate search function.

## Backend
- [ ] `user-management.ts`: add `DEVELOPER_TOOLS` to
      `assertHasUserManagementOrCreditIssuancePermission`'s allowed set
      (rename mentally-wise it's still "search access", the function name
      itself doesn't need to change — it's already an internal, unexported
      helper, no external naming contract to break).
- [ ] `developer-tools.ts`: new `listActiveInvestmentsForSimulation(actingAdminId, targetUserId)`
      — DEVELOPER_TOOLS-gated, returns id, package name, amount,
      purchasedAt, status for every ACTIVE investment belonging to
      targetUserId. (Ticket says "active investments" explicitly — a
      CAPITAL_RELEASED investment can't usefully simulate interest on
      anyway, since accrueDailyInterestForInvestment itself immediately
      skips those — so scoping the list to ACTIVE-only is both what was
      asked and avoids offering a selection that would just silently
      no-op every simulated day.)
- [ ] `actions.ts`: `searchUsersForSimulationAction(query)` (wraps
      `searchUsers` from user-management.ts, DEVELOPER_TOOLS-gated at the
      action layer same as every other action here) and
      `listActiveInvestmentsForSimulationAction(userId)`.

## Frontend
- [ ] Rewrite `daily-interest-simulator.tsx`:
      1. User search input (debounced, same 300ms pattern as
         credits/user-picker.tsx) -> small results list (name + email)
      2. Selecting a user loads their active investments (a loading
         state, then a list — package name, amount, purchasedAt
         formatted date, status badge)
      3. Selecting an investment row sets the internal investmentId state
         and shows the same "confirmed investment" summary card the old
         raw-ID flow showed (owner/package/amount/status) — reuses
         SimulationInvestmentRow's shape, now populated from the
         investment-list response instead of a lookup-by-id call
      4. A "change user" / "change investment" affordance to reset and
         search again
      5. Days input + confirm dialog + summary: UNCHANGED from the
         existing implementation
      - Investment ID never appears as visible or typeable text anywhere.
- [ ] Keep `lookupInvestmentForSimulationAction`/`findInvestmentForSimulation`
      (still used internally by `simulateDailyInterestAction`'s own
      server-side re-validation? — check: `simulateDailyInterestDays`
      re-fetches the investment by id itself already for its own
      existence check, so `findInvestmentForSimulation` was ONLY ever
      used by the old UI's lookup-by-id step. Once the raw-ID input is
      gone, decide: keep the function (now unused) or remove it as dead
      code — DEFAULT: remove it and its action wrapper, since this
      project's convention is no dead code; the new investment-list
      response already carries everything the old summary card needed.

## Translations
- [ ] New keys: user search label/placeholder, "searching…", no-results,
      investment-list loading/empty states, "change user"/"change
      investment" labels. Remove now-unused simulateInvestmentIdLabel/
      simulateInvestmentIdPlaceholder/simulateLookUp/simulateLookingUp/
      errorInvestmentNotFound keys ONLY if truly unused after the
      rewrite — verify with grep before deleting any translation key.

## Verification
- [x] tsc --noEmit clean
- [x] New tests: listActiveInvestmentsForSimulation (5 tests: permission
      gate, ACTIVE-only scoping, excludes CAPITAL_RELEASED, never another
      user's investments, empty case) + searchUsers DEVELOPER_TOOLS-only
      sub-admin case in user-management.test.ts. 39/39 passing.
- [x] Confirmed via grep: every `.id` reference in the new component is
      either an internal function argument or a React `key` prop — never
      rendered as visible text/DOM content. No raw investment id is ever
      shown to the admin.
- [x] Confirmed route compiles and loads cleanly (307 redirect for
      unauthenticated, no runtime errors in logs) after restart
- [x] Full suite: 632/633 passing (1 pre-existing skip), 0 failures this
      run — the 2 calendar-drift tests from last session happened to pass
      this time (their pass/fail depends on exact real-time vs. real
      worker job_runs state, not something either session's diff
      controls)
- [x] Kept findInvestmentForSimulation/lookupInvestmentForSimulationAction
      (now step 3 of the new flow: confirm-details after a list row is
      clicked) rather than removing as dead code — still genuinely used
- [x] Commit + push
