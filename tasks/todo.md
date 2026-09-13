# Admin layout & nav shell — DONE

Admin had 12 real screens with zero navigation between them. Built via a
proper Next.js layout split (not a patch).

## What shipped
- `[locale]/layout.tsx` trimmed to shell-only (`<html>/<body>/
  NextIntlClientProvider`) — no header, no nav of its own anymore.
- NEW route group `[locale]/(app)/` (invisible in the URL — no URL changes):
  the 10 existing user-facing route folders (dashboard, binary-tree,
  investments, login, packages, referrals, register, transactions,
  withdrawals, preview) plus the root `page.tsx`, moved via `git mv` with
  zero code changes (all imports already used `@/` aliases). New
  `(app)/layout.tsx` carries the existing user-dashboard header verbatim
  (Logo, DashboardNav, LanguageSwitcher, LogoutButton).
- NEW `[locale]/admin/layout.tsx`: a dedicated Deep Teal (`--sidebar:
  #06201f`) sidebar using the `sidebar-*` design tokens already defined in
  globals.css but unused until now. New `src/components/admin-sidebar-nav.tsx`
  lists all 12 admin screens (Users, Sub-Admins, Withdrawals, Credits,
  Packages, Interest Rate, Commission Config, Rank Config, Manual
  Adjustment, Job Monitor, Solvency, Ledger) with active-route highlighting,
  reusing the same `LogoFull`/`LanguageSwitcher`/`LogoutButton` components
  (no new logo/logout code). New `AdminNav` message namespace, both locales.
- The admin layout does NOT gate access itself — every admin `page.tsx`
  still calls its own `requirePermissionOrRedirect`/`requireMainAdminOrRedirect`
  (invariant #8's real enforcement, unchanged). All 12 links always render
  regardless of the acting admin's specific grants — clicking one they lack
  redirects exactly as it did before this nav existed (per-permission nav
  filtering is a separate, larger feature, out of this ticket's "no logic
  changes" scope).

## Verification
- `npx tsc --noEmit` (after clearing the host's stale `.next` type cache
  left over from the file move) — clean.
- `npx eslint` across every touched/moved file — 0 errors (29 pre-existing
  `Number()`-coercion warnings, unrelated to this change, same as noted in
  prior phase todo.md entries).
- Live verification against the real running app (fresh admin + a real
  WITHDRAWAL_APPROVAL-only sub-admin session, both cleaned up after):
  - All 12 admin URLs return 200 post-move, no broken routes.
  - Admin sidebar shows all 12 links on `/admin/users`; zero
    user-dashboard-nav links (`/dashboard`, `/binary-tree`, etc.) present
    on that page.
  - Reverse check: `/dashboard` shows the full user nav (including the
    "Admin Panel" link from the prior ticket) with zero admin-sidebar links
    leaking in.
  - Route-level permission enforcement unchanged: the WITHDRAWAL_APPROVAL
    -only sub-admin still gets 200 on `/admin/withdrawals` and a real 307
    redirect to `/dashboard` on `/admin/credits` — proves the new layout
    added zero new auth surface, exactly as designed.
  - `/ar/admin/users`: RTL confirmed (`dir="rtl"`), Arabic nav labels render
    correctly ("المستخدمون", "المشرفون الفرعيون", "السحوبات", "لوحة الإدارة").
- Full suite (`npx vitest run`): **478/479** — the 1 failure is the same
  pre-existing documented `-27.33841602` reconciliation drift, no new
  regressions from the file moves or layout changes.

## Lessons logged
Per the user's explicit request, added an entry to `tasks/lessons.md`
(2026-09-13) capturing that Phase 10 and Phase 11 both shipped multiple
screens without a containing layout/nav shell built first, and the standing
rule that the shell must be the first ticket in any multi-screen phase
going forward.
