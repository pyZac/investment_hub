# Current Session Todo

> Claude Code: overwrite this file at the start of each session with the checklist
> for the phase you're working on. Check items off as you complete them. Leave the
> "Review" section filled in at the end so the human reviewer (Zac) can see what
> happened without re-reading the whole transcript.

## Phase: 1 — Auth & Users (Task 9 of N: SCRUM-31, Phase 1 exit test)

- [x] Wrote `scripts/phase1-exit-test.ts` covering every clause of the exit
      test in `/docs/phases/phase-01-auth-users.md`, calling the real library
      functions for steps with no HTTP route yet (registration, security-
      question reset, admin manual reset, route guard) and hitting the real
      running dev server over HTTP for steps that do have routes (login,
      logout, TOTP enroll/verify)
- [x] Ran it against a live `npm run dev` instance and the real dev DB —
      **all 15 steps passed**
- [x] Fixed a script bug (not a product bug) where the lockout scenario's
      failed attempts also tripped per-IP rate limiting for the subsequent,
      unrelated admin-login scenario, since every request in the script
      shares one source IP — added a targeted cleanup between scenarios
- [x] Cleaned up all exit-test data after the run (test users, sessions,
      security events, main admin's TOTP state reset back to null) —
      verified via direct DB query
- [x] Re-ran the full unit test suite after the exit test — still 82/82

## Review

**What the exit test script actually exercises, end to end, with real output
shown to Zac (see chat transcript for the full run):**

1. `registerAsRoot` — root user, `sponsorId` confirmed null.
2. `registerWithSponsor` — a second user placed under the root's referral
   link, `sponsorId` confirmed to equal the root's id.
3. A third user registered under the same referral link (satisfies "register
   two users, one under the other's referral link... register a third" —
   read literally as 2 referred + 1 root = 3 total self-registrations).
4–5. Real HTTP login (`POST /api/auth/login`) as both the root and the
   referred user — real `Set-Cookie` with `Secure; HttpOnly; SameSite=strict`
   flags confirmed in the response.
6. `requirePermission`/`requireAdmin` reject a request with no valid admin
   session (`AuthError`, 401) — since no admin *routes* exist yet (Phase 6),
   this exercises the actual guard mechanism directly rather than an HTTP
   404, which is the correct thing to test: the guard itself, not routing.
7. `resetPasswordViaSecurityQuestions` — root user resets their own password
   with the 3 answers set at registration, then logs in with the new
   password over real HTTP.
8. `adminResetPassword` — main admin resets the referred user's password;
   confirmed the `admin_actions` row (`actionType: PASSWORD_RESET`, correct
   `adminId`/`targetUserId`/`reason`) and that the new password works via
   real HTTP login.
9. `requirePermission` called for all 11 catalog permissions against the
   main admin's real session token — confirmed `admin_permission_grants`
   has **zero** rows for this admin, yet every permission check passes
   (`is_main_admin` short-circuit, invariant #8).
10. 5 wrong-password HTTP login attempts, then a 6th with the *correct*
    password — still rejected (429, distinct lockout message, no cookie
    set), with the `ACCOUNT_LOCKED` `security_events` row shown as evidence
    it's a visible event, not a silent failure.
11–15. Main admin's TOTP reset to null → real HTTP login → correctly returns
    `totp_enrollment_required` (no session) → real enrollment via
    `/api/auth/totp/enroll` + `/confirm` with a genuinely-computed TOTP code
    → logged out → second login now returns `totp_required` (not
    re-enrollment) → wrong code rejected (401, no cookie) → correct code
    creates a real session with correct cookie flags.

**Bug found and fixed (script-only, not product code):** the lockout
scenario (step 10) and the TOTP scenario (steps 11-15) both run from the
same script process, so they share one source IP. The per-IP rate limit from
step 10's 5 failures was still active when step 11 tried to log in as the
admin, causing a false failure. Fixed by clearing `LOGIN_FAILED`/
`ACCOUNT_LOCKED` security events between the two scenarios — this is a
test-harness artifact of running everything from one script/IP, not a
product defect (in reality these would be different users from different
IPs).

**Full exit test output:** shown in the conversation — all 15 steps printed
their real response bodies, cookies, and DB rows, ending in
`=== ALL PHASE 1 EXIT TEST STEPS PASSED ===`.

**Cleanup verified:** `SELECT count(*) FROM users WHERE email LIKE
'exit-%@test.local'` → 0. Main admin's `totp_secret` confirmed null again
after the script's cleanup ran. Full unit suite re-run afterward: 82/82
still passing, confirming the exit-test run didn't leave the DB in a state
that broke anything else.

**Phase 1 status:** every deliverable in the phase brief has a task behind
it (SCRUM-23 through SCRUM-29) and the exit test — run for real, not
inspected — passes end to end. Awaiting Zac's confirmation in the
operation-room chat before Phase 2 starts, per the build order rule in
CLAUDE.md.
