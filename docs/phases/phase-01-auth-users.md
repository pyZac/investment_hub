# Phase 1 — Auth & Users

**Goal:** users can register and log in; the admin role and permission system exist.

**Prerequisites:** Phase 0 complete, its exit test passed.

**Read before starting:** `/docs/build_plan.md` Part 3 (schema outline for `users`
and `admin_permission_grants`, plus the "Admin Roles" section with the full
permission catalog) and Part 7 (Security Architecture — auth section).
`/docs/mlm_rules_log.md` Section 7 (Account Creation).

## Deliverables

1. `users` model per the schema outline: `id, email, password_hash, name, role,
   is_main_admin, created_by_admin_id, sponsor_id, locale, suspended_at, created_at`.
2. `admin_permission_grants` table with `UNIQUE(admin_user_id, permission)` and the
   fixed permission enum (11 permissions — see the catalog table in the build plan).
3. Password hashing with **argon2id**, never reversible encryption.
4. **Three account-creation paths:**
   - self-registration with a sponsor referral code (places new user in sponsor tree)
   - self-registration with no code — becomes a new tree root (both sponsor and
     placement tree); intended for the first user, not hard-blocked at schema level
   - admin-created accounts (sets initial password, optionally assigns a sponsor),
     logged to `admin_actions`
5. **Security questions** at registration (2–3, hashed answers) for self-service
   password reset. Admin-created accounts set theirs on first login.
6. **Admin manual password reset** — admin panel action, logged to `admin_actions`.
   There is no email/SMS in this system, so no token-based reset flow exists.
7. Session handling: `httpOnly`, `secure`, `sameSite=strict` cookies. Shorter idle
   timeout for admin sessions (~30 min) than user sessions (a few hours).
8. **Rate limiting + lockout** on login, password reset, and security-question
   endpoints (e.g. 5 attempts / 15 min, per-IP and per-account), with the lockout
   logged as a visible security event, not a silent failure.
9. **Mandatory 2FA (TOTP)** for all admin and sub-admin accounts; optional for users.
10. **Permission-based route guard** — checks the specific grant required by the
    route, not a blanket "is admin". `is_main_admin = true` short-circuits to allowed.
11. Seed script creating exactly one main admin (`is_main_admin = true`, no
    explicit grants needed).

## Constraints specific to this phase

- Sub-admins are created only by the main admin. Sub-admins can never create
  further sub-admins, even if somehow granted — avoid privilege-escalation chains.
- Admin account management is *not* in the grantable permission catalog; it is
  main-admin-only by construction.
- `sponsor_id` is the **sponsor tree only**. Binary placement is a separate
  structure built in Phase 7 — do not create or imply placement links here
  (invariant #5).
- No hard delete on users anywhere in this phase (invariant #7).
- All new UI strings go through next-intl keys, with both `en` and `ar` catalogs
  populated. No hardcoded English.

## Exit test

Register two users, one under the other's referral link. Register a third with no
code (becomes a root). Log in as each. Confirm an admin route is blocked for a
normal user. A user resets their password via security questions. An admin resets
a user's password manually. The main admin reaches every admin route with no
explicit grants. Repeated failed logins trigger lockout. Admin login requires a
valid TOTP code after the password.

Run it and show the output.
