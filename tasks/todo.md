# Session: Logo fix verification + password show/hide + admin settings page

## FIX 1 — Logo mark missing in admin sidebar
- [x] Investigated: source code was already correct (viewBox/size already fixed in a prior
      commit). Root cause was a stale `next dev` compile in the running container —
      confirmed via DOM inspection (was serving old `viewBox="0 0 1080 1080"`/`h-9 w-9`,
      not the committed `313.48 336.47 453.06 407.11`/`h-16 w-16`).
- [x] Restarted the `app` container; re-inspected DOM — now serving the correct/updated
      SVG. No code change needed. Nothing to commit for this fix.

## FIX 2 — Password show/hide toggle (all password inputs)
Files with `type="password"` inputs:
- [ ] `src/components/login-form.tsx` (login password field)
- [ ] `src/components/change-password-form.tsx` (current/new/confirm — 3 fields)
- [ ] `src/app/[locale]/admin/users/create-user-form.tsx` (initial password field)
- [ ] `src/app/[locale]/admin/sub-admins/create-sub-admin-form.tsx` (initial password field)

Plan: build one shared `<PasswordInput>` component (wraps existing `Input`, adds an
eye/eye-off icon button toggling `type="password"`/`"text"`, 44px touch target per the
mobile-responsiveness pass), then swap each of the above call sites to use it instead of a
raw `<Input type="password">`. Zero backend change — purely a client-side UI toggle, no
`.value` exposure change, no new prop threading into server actions.

## FIX 3 — Admin account settings page
- [ ] Schema: add `EMAIL_CHANGED` to `SecurityEventType` enum (confirmed with user — matches
      existing TOTP_ENROLLED/REMOVED audit pattern). One additive migration, no data change.
- [ ] `src/lib/auth.ts`: add `updateAdminEmail(userId, input)`:
  - Zod-validated new email, requires current password (same proof-of-identity bar as
    `changePassword`), rejects if new email already in use (unique constraint + friendly
    error, not a raw Prisma error leak), writes `SecurityEvent` (`EMAIL_CHANGED`) same
    pattern as TOTP enroll/remove. Takes `userId` from the caller's own session only
    (invariant #9 — never trust a client-supplied id).
- [ ] `src/lib/totp-enrollment.ts` or new function: session-scoped TOTP **re-enrollment** for
      an already-logged-in admin (existing `beginTotpEnrollment`/`confirmTotpEnrollment` are
      pending-token/login-flow-scoped, not usable directly from an authenticated session).
      Plan: add `beginTotpReenrollment(userId, forDate)` (generates new secret, returns
      otpauth URI, does NOT persist yet — mirrors `beginTotpEnrollment`'s shape minus the
      pending-token machinery) and `confirmTotpReenrollment(userId, secret, code, forDate)`
      (verifies code, persists, logs TOTP_ENROLLED — reuses `removeTotp`'s require-current
      -code pattern is NOT needed here since re-enrollment always starts by generating a
      brand new secret, same trust level as first-time enrollment via a live session).
- [ ] New API routes: `POST /api/admin/update-email`, reuse `/api/auth/change-password` as
      -is for password, new `POST /api/admin/totp/reenroll/begin` +
      `POST /api/admin/totp/reenroll/confirm`. All gated by `requireSession` +
      `isMainAdmin` check (main-admin-only page per FIX 3's wording).
- [ ] New page: `src/app/[locale]/admin/settings/page.tsx`, gated by
      `requireMainAdminOrRedirect` (matches sub-admin-management's own gating pattern).
      Sections: change email, change password (reuse `ChangePasswordForm`), re-enroll TOTP
      (new client component with QR code + confirm code input, mirrors the login-flow
      enrollment UI in `login-form.tsx`).
- [ ] Add sidebar link: `src/components/admin-sidebar-nav.tsx` — new nav item, translated
      label, only shown to... (nav shows all links regardless of permission today per its
      own comment; page itself gates via `requireMainAdminOrRedirect`, consistent with
      existing pattern for sub-admins page).
- [ ] Translations: add EN/AR strings for the new page + nav label.

## Tests
- [ ] `src/lib/auth.test.ts`: tests for `updateAdminEmail` — success, wrong current password,
      duplicate email, non-existent user.
- [ ] `src/lib/totp-enrollment.test.ts` (or new file): tests for re-enrollment begin/confirm
      — success path, wrong code, old secret invalidated after new one confirmed.

## Verification
- [ ] `npx tsc --noEmit` clean.
- [ ] Full test suite run (background, sequential per project convention).
- [ ] Manual check: settings page renders, main-admin-only gating works (sub-admin
      redirected), password toggle works on all 4 password fields, EN+AR.

## Commit + push
- [ ] Commit (exclude `docker-compose.yml` — standing instruction, still local-only for
      DISABLE_ADMIN_TOTP dev convenience).
- [ ] Push to main.
