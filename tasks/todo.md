# Mobile responsiveness pass — post-phase editing session

Scope: visual/UX only. Zero logic, DB, or API changes. No new business rules.

## Step 1 — Shared responsive primitives (do first, unlocks everything else)
- [ ] Build a reusable `<Table>` wrapper (`src/components/ui/data-table.tsx` or similar) that
      wraps any table markup in `overflow-x-auto` with a min-width inner table, so every
      existing raw `<table>` page gets horizontal scroll by wrapping, not rewriting.
- [ ] Add a `<MobileNavSheet>` / hamburger trigger using existing `Dialog` primitive (no new
      dependency) for admin sidebar collapse.
- [ ] Establish the convention doc comment in the shared layouts so future pages inherit it
      (per user's "future pages must inherit responsiveness" requirement).

## Step 2 — Admin shell (`src/app/[locale]/admin/layout.tsx` + `admin-sidebar-nav.tsx`)
- [ ] Sidebar hidden below `lg:`, replaced with a top bar containing a hamburger button.
- [ ] Hamburger opens the nav (Dialog/Sheet-style overlay) with the same `AdminSidebarNav`
      links; closes on link click or overlay tap.
- [ ] Keep desktop layout (`lg:flex` sidebar) unchanged visually.
- [ ] Verify RTL: hamburger + overlay use logical positioning (`inset-inline-start`, not
      `left-*`), matches bilingual-rtl skill.

## Step 3 — User dashboard shell (`(app)/layout.tsx` + `dashboard-nav.tsx`)
- [ ] Collapse `DashboardNav` into a hamburger on small screens (same pattern as admin).
- [ ] Header row wraps/stacks correctly at 375–440px (logo, nav, language switcher, logout).

## Step 4 — Apply table-scroll wrapper to all 14 files with raw `<table>`
security-events, ledger, job-monitor, manual-adjustment, rank-config (x2), commission-config,
interest-rate, packages, credits, withdrawals (x2), users, sub-admins.

## Step 5 — Page-by-page pass for cards/forms stacking + no text cutoff
User: /login, /dashboard, /binary-tree, /referrals, /withdrawals, /transactions,
/dashboard/profile.
Admin: /admin/users, /admin/sub-admins, /admin/withdrawals, /admin/credits, /admin/packages,
/admin/interest-rate, /admin/commission-config, /admin/rank-config, /admin/manual-adjustment,
/admin/job-monitor, /admin/solvency, /admin/ledger, /admin/security-events.
- Grids → `grid-cols-1` base, expand at `sm:`/`lg:`.
- Forms → stack fields full-width on mobile.
- Ensure touch targets (buttons, nav links) are >= 44px on mobile.

## Step 6 — RTL check on mobile
Spot-check /ar at 375px for at least: admin layout, dashboard layout, one table page, one form
page — confirm hamburger and overlay mirror correctly.

## Step 7 — Verification
- [x] `npx tsc --noEmit` clean.
- [x] Run existing automated test suite. 2 pre-existing failures found
      (`reconciliation.test.ts`, `phase-4-exit-test.test.ts`), both whole-DB solvency
      checks — confirmed via `git diff --stat` (zero `src/lib/*`/schema files touched this
      session) and by reproducing `reconciliation.test.ts` standalone (same drift, not a
      full-suite race). Root cause: pre-existing ~27.34 unit drift in the shared dev DB,
      unrelated to this visual-only session. Flagged to user, not repaired (out of scope for
      a zero-logic-change session; repairing wallet/ledger drift is a money-precision-skill
      task, not a CSS one).
- [~] Manual resize check at 375/440/768px: blocked for authenticated pages by TOTP 2FA
      (correctly enforced) — user chose code-review verification over minting a bypass
      session. Verified via Tailwind class audit (Explore agent) + fixed 2 real bugs found
      (touch targets on 5 clear-buttons, text-cutoff risk in reversal-confirm-dialog) + fixed
      1 self-introduced RTL bug (physical `left-0`/`top-0` in MobileNavSheet → `inset-0`).
      Login page screenshotted successfully at all 3 widths, EN+AR — clean.
- [x] Reported back after each major section.
