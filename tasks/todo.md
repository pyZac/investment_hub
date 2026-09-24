# Session: Developer Tools admin page (job triggers + Friday-gate bypass)

Confirmed with user before building:
- Job triggering (ticket step 1) is largely already built (job-monitor.ts +
  /admin/job-monitor). We EXTEND it (confirmation dialog + missing
  reconciliation label) rather than duplicate it. No new REST API — use a
  Server Action, matching every other admin action in this app (zero
  existing /api/admin/* routes exist).
- Friday-bypass flag covers ALL THREE real Friday-gated actions:
  transferAtoB (A->B profit), releaseCapital (capital release),
  submitWithdrawalRequest (B-exit submission) — i.e. every real caller of
  `assertFriday`. transferCtoB has no Friday gate already (confirmed, not
  touched).
- Storage: NOT commissionConfig (wrong semantics — that's a versioned rate
  table, this is an unrelated boolean). NOT in-memory on the worker (the
  worker is a genuinely separate container/process from the `app`
  container that runs the Server Actions calling assertFriday — an
  in-memory flag there would be invisible to the code that needs to read
  it). New tiny DB-backed singleton table instead, same
  "at-most-one-row" pattern as existing config tables.

## Schema changes
- [ ] New `DeveloperToolsSetting` model: `id`, `bypassFridayGate Boolean
      @default(false)`, `updatedAt`, `updatedByAdminId String?` (FK to
      User, nullable like commissionConfig's setByAdminId). Enforce
      singleton via seeding exactly one row (id fixed, e.g. "singleton")
      rather than a partial-unique-index trick — simpler for a table that
      is UPDATED in place (not versioned/append-only like commission_config),
      since this is genuinely mutable operational state, not a financial
      rate history.
- [ ] New `AdminPermission` enum value: `DEVELOPER_TOOLS`.
- [ ] New `AdminActionType` enum values: `JOB_MONITOR_TRIGGERED` already
      exists (reuse for job triggers from this page too — same action,
      same meaning). Add `FRIDAY_GATE_BYPASS_TOGGLED`.
- [ ] Migration: hand-written (matches project convention for
      constraints/singleton seeds) — create table, seed the one row.

## Backend
- [ ] `src/lib/withdrawal-guard.ts`: `assertFriday` becomes async, reads
      the singleton row; if `bypassFridayGate` is true, returns without
      throwing regardless of the real day. Update its 3 callers
      (transfers.ts, capital-release.ts, withdrawal-requests.ts) to
      `await assertFriday(...)`.
- [ ] New `src/lib/developer-tools.ts`:
      - `assertHasDeveloperToolsPermission` (same pattern as every other
        lib file's permission check)
      - `getFridayBypassStatus(actingAdminId)`: read-only, returns
        `{ enabled, updatedAt, updatedByAdminName }`
      - `setFridayBypass(actingAdminId, enabled, forDate)`: updates the
        singleton row, logs `FRIDAY_GATE_BYPASS_TOGGLED` to admin_actions
        with enabled/disabled in the reason text
      - Re-export/wrap `listJobStatuses`/`triggerJobRun` from job-monitor.ts
        rather than reimplementing — this page is a consumer, not a fork.
- [ ] `src/app/[locale]/admin/developer-tools/actions.ts`: Server Actions
      wrapping the above (`requirePermission("DEVELOPER_TOOLS", ...)`
      first, per invariant #8), mirroring job-monitor/actions.ts's shape.

## Frontend
- [ ] `src/app/[locale]/admin/developer-tools/page.tsx`: page shell,
      `requirePermissionOrRedirect("DEVELOPER_TOOLS", ...)`.
- [ ] `src/app/[locale]/admin/developer-tools/job-trigger-list.tsx`: like
      job-status-list.tsx but with a Dialog confirmation step before
      calling trigger (per frontend-design skill's "every destructive/
      consequential action shows a confirmation step" rule) — reuses
      listJobStatuses/triggerJobRun via the new page's own actions.ts.
      Include reconciliation's label (missing from job-monitor's own
      JOB_TYPE_LABEL_KEYS — fix there too since it's a pre-existing gap
      this page would otherwise inherit).
- [ ] `src/app/[locale]/admin/developer-tools/friday-bypass-toggle.tsx`:
      a switch/toggle, clearly labeled "Testing only — bypasses Friday
      withdrawal restriction" (destructive/warning color treatment per
      design skill's semantic-color rule), shows who last changed it and
      when.
- [ ] Also fix job-monitor's own `JOB_TYPE_LABEL_KEYS` to include
      `reconciliation` (pre-existing gap, low-risk one-line fix, avoids
      shipping a second page with the same known bug).
- [ ] Add confirmation dialog to the EXISTING job-monitor page too, or
      leave it as-is and only add it to the new Developer Tools page? —
      DECISION: add to both, since triggering these jobs manually is
      exactly the kind of consequential action the design skill says
      needs a confirm step, and leaving job-monitor's own trigger button
      without one while the new page has one is an inconsistent standard
      for the same action reachable from two places.
- [ ] `admin-sidebar-nav.tsx`: add a "Developer Tools" link.
- [ ] Translations: new `AdminDeveloperTools` namespace in en.json/ar.json
      (bilingual, per project convention) + one new `AdminNav` key.

## Verification
- [x] tsc --noEmit clean (also required adding DEVELOPER_TOOLS to two
      unrelated exhaustive/hand-maintained lists: security-log.ts's
      Record<AdminActionType,...> label map, and the sub-admin
      create/edit forms' hand-maintained PERMISSION_CATALOG arrays +
      permission_DEVELOPER_TOOLS translation key — none of these were in
      the original plan, found only by tsc/manual grep)
- [x] New tests: developer-tools.test.ts (8 tests: permission gate, main
      admin bypass, toggle round-trip, attribution, audit log);
      withdrawal-guard.test.ts rewritten for async assertFriday +
      4 new bypass-on/off cases (8 total)
- [x] transfers.test.ts/capital-release.test.ts/withdrawal-requests.test.ts
      all pass unchanged (39 tests) — confirms bypass-off behaves
      identically to the pre-change Friday gate
- [x] Manually verified the full real call chain (assertFriday reading
      the live singleton row) via tsx, not just unit tests in isolation
- [x] Full suite: 616/617 (1 pre-existing skip), 0 reconciliation drift
- [x] Commit + push
