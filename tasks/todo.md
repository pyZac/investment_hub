# Task: Phase 10 UX gaps — logout, nav, change-password (pre-commit)

## Context
Phase 10 (SCRUM-90..102) exit test passed. Closing 3 standard shell gaps before
commit. UI/routing only — no logic/DB/API changes except a new, narrowly-scoped
change-password endpoint (Phase 1 auth layer already has hashPassword/verifyPassword).

## Completed
- [x] Read lessons.md + phase-10 brief in full
- [x] Investigated existing session/auth/login wiring, page structure, message keys
- [x] `changePassword(userId, { currentPassword, newPassword })` added to
      `src/lib/auth.ts` (verifies current via verifyPassword, hashes new via
      hashPassword, min 8 chars) + 3 unit tests in `auth.test.ts`
- [x] `POST /api/auth/change-password` route — requireSession + changePassword,
      maps AuthError to its real status, validation errors to 400
- [x] `Nav` + `Profile` message keys added to both `messages/en.json` and
      `messages/ar.json` (financial-glossary rule respected — "Binary Tree"
      stays English in Arabic nav per existing BinaryTree.pageTitle precedent)
- [x] `src/components/dashboard-nav.tsx` — client nav, 6 links (Dashboard,
      Binary Tree, Referrals, Withdrawals, Transactions, Profile), active-state
      highlighting via usePathname, RTL-safe (logical flex, no physical
      left/right classes)
- [x] `src/components/logout-button.tsx` — client, POSTs /api/auth/logout,
      then router.push("/login") + router.refresh()
- [x] Wired both into `src/app/[locale]/layout.tsx`'s header, gated on session
      cookie presence (reads via next/headers cookies() — layout already async)
- [x] `/[locale]/dashboard/profile/page.tsx` + `src/components/change-password-form.tsx`
      (current/new/confirm fields, client-side length+match validation, calls
      the new API route)
- [x] Full isolated test suite: 339/340 passing. The 1 failure is a
      pre-existing, permanent, documented discrepancy in
      reconciliation.test.ts (see lessons.md's 2026-09-08/09 entry) — an
      orphaned ledger-entry pair from an earlier concurrent-vitest-run
      accident, undeletable by the ledger's own append-only invariant, not
      caused by or related to this session's code.
- [x] tsc --noEmit clean throughout

## Real bug found + fixed during manual verification (not originally scoped,
## but directly surfaced by GAP 1's own requirement that logout redirects to /login)
- [x] **Found**: every one of the 8 protected pages (dashboard, profile,
      binary-tree, referrals, withdrawals, transactions, investments, packages)
      relied on `requireSession()`/`requireAdmin()` throwing `AuthError`
      uncaught. There is no middleware-level auth check (middleware.ts only
      does locale routing) and no error.tsx boundary existed, so a direct/hard
      navigation to any of these pages while unauthenticated rendered a raw
      500, not a redirect to /login. This included the logout flow itself:
      after clicking Log out, a follow-up hard navigation back to a protected
      URL 500'd instead of redirecting.
- [x] **Fixed**: `src/lib/page-guard.ts` — new `requireSessionOrRedirect()`
      wrapping `requireSession()`, calling Next's `redirect("/login")` on
      `AuthError`. Kept separate from `route-guard.ts` itself (not merged into
      `requireSession`) because `redirect()` throws a signal that only works
      in a real request context — route-guard.ts's own unit tests call
      `requireSession()` directly under plain Vitest, so coupling it to
      `next/navigation` would break them.
      Swapped `requireSession` -> `requireSessionOrRedirect` in all 8 pages.
      Also added `src/app/[locale]/error.tsx` as a client-side defense-in-depth
      boundary for the same AuthError class reached via client-side navigation
      (the SSR redirect in page-guard.ts is the real fix; error.tsx is a
      backstop, not load-bearing).
- [x] Verified via Playwright against the live dev server (login, click
      through all 6 nav links + profile, wrong-password error text, correct
      password change + success message, logout, then a **hard navigation**
      (not just client-router state) back to a protected route -> confirmed
      200 + redirect to /login, not 500). Repeated the login + dir="rtl"
      check in /ar with the changed password.

## Known standing issue, not fixed (by design, per user + code-review decision)
- `reconciliation.test.ts`'s 1 failure — see lessons.md. Do not attempt to
  "fix" runReconciliation() to skip missing-wallet entries; that would defeat
  its purpose as a tampering/corruption detector. Do not attempt to delete the
  orphaned ledger rows; blocked by the ledger's own append-only DB trigger,
  which is invariant #2 working as intended.
