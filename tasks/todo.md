# Session todo — Admin dashboard overview page (/admin/overview)

Post-phase feature. Read-only aggregation page, main-admin only. No new
financial logic — reuse existing engine functions/queries wherever possible.

## Plan

1. Backend: new `src/lib/admin-overview.ts` with one function
   `getAdminOverview(actingAdminId, forDate)`:
   - Main-admin-only gate (mirrors requireMainAdminOrRedirect at the page
     level; the lib function itself checks `isMainAdmin` directly, same
     posture as other main-admin-only lib functions in this codebase, e.g.
     admin-management.ts).
   - **Investments overview**: count + sum(amount) of `status: "ACTIVE"`
     investments; group by package (packageId -> name, count, sum(amount));
     total locked capital = same sum as active investments' total value
     (capital IS the investment amount while ACTIVE, per solvency.ts's own
     documented reasoning — no separate "locked" pool to sum); upcoming
     releases = ACTIVE investments whose `capitalUnlocksAt` falls in
     `[forDate, forDate + 30d]`, joined to user name + package name.
   - **Platform financial health**: call `getSolvencyOverview(actingAdminId, forDate)`
     directly (reuse, not reimplement) — but that function's own
     SOLVENCY_VIEW gate would reject a main-admin-only caller only if they
     don't hold it; main admin always bypasses per its own assertion, so
     this is safe to call with the same actingAdminId.
   - **User activity**: total user count (role: "USER" — admins aren't
     "users" for this stat), marketer count (isMarketer: true), suspended
     count (suspendedAt not null), new-this-month count (createdAt's own
     dubaiMonthKey === forDate's dubaiMonthKey, reusing rank.ts's existing
     `dubaiMonthKey` helper — no new month-boundary arithmetic).
   - **Job health**: call `listJobStatuses(actingAdminId)` directly (reuse).
   - All money values returned as Prisma.Decimal, converted to display
     strings only at the page/action boundary (invariant #1).
2. Page: `src/app/[locale]/admin/overview/page.tsx` (Server Component,
   `requireMainAdminOrRedirect`) + client stat-card components, split into
   4 section components matching the 4 requested sections. Mirrors the
   solvency/job-monitor page structure (Server Component fetches once,
   passes down as props — no client-side action needed since this is pure
   read-only glance data, refreshed on page reload like solvency's initial
   render, though solvency also offers a manual refresh button; decide
   during build whether this page needs one too — lean no, since instructed
   as a "glance view").
3. Nav: add as the FIRST entry in `admin-sidebar-nav.tsx`'s `ADMIN_NAV_ITEMS`.
4. Translations: new `AdminOverview` + one `AdminNav.overview` key, EN+AR.
5. Tests: `src/lib/admin-overview.test.ts` — main-admin-only gate rejects a
   sub-admin/non-admin, investment counts/breakdown/locked-capital correct,
   upcoming-releases window correct (in-window vs out-of-window boundary),
   user-activity counts correct, job-health delegates correctly (reuses
   existing job-monitor test patterns/helpers). Use
   `cleanupLedgerEntriesForUsers` for any ledger-writing setup (admin
   credits, if needed to fund purchases) per the standing structural rule.
6. Run full suite (not just new file). `tsc --noEmit`.
7. Manual live verification EN + AR (frontend-design skill's 9-point
   checklist; bilingual-rtl skill's RTL specifics — icon+text pairs,
   sign+number dir="ltr", logical corner positioning).
8. Commit and push.

## Design notes
- Stat cards use the existing Deep Teal & Mint theme (Card/CardHeader/
  CardTitle/CardContent primitives already used throughout the admin panel
  — no new design tokens needed).
- Mobile responsive grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` style,
  matching solvency/existing dashboard patterns).
- Package breakdown and upcoming releases render as compact
  tables/lists, consistent with job-monitor's table pattern.
