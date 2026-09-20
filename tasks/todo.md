# Session todo — Re-enable self-registration via referral link

Post-phase feature. Reopens `/[locale]/register` (was a permanent redirect
to `/login`), gated on a valid `?ref=<sponsorUserId>` query param.

## Status: complete

1. [x] Backend: `registerWithSponsor` now takes `isMarketer?: boolean`
   (defaults false via Zod, `RegistrationInput` switched to `z.input` so
   existing call sites stay unaffected). New `validateReferralCode(code)` —
   looks up the sponsor by raw user id (confirmed: the referral "code" IS
   the sponsor's cuid, per referrals/page.tsx's existing buildReferralLink),
   returns `{valid:false}` or `{valid:true, sponsorName}`.
2. [x] `register/page.tsx` redirect removed. Validates `?ref=` server-side;
   invalid/missing shows a blocking message + Back to login link, no form.
   Valid ref renders the form inside the login-matching Card/LogoFull shell.
3. [x] `register-form.tsx` — Name, Email, Password/Confirm (PasswordInput
   with toggle), read-only referral code, marketer checkbox (reused
   admin create-user form's exact checkbox markup), 3 security-question
   fields (added per confirmed decision — registerWithSponsor requires
   them and the task's own field list omitted them).
4. [x] `register/actions.ts` — public unauthenticated `registerAction`,
   re-validates ref and password match server-side (never trusts client
   validation alone). Redirects to `/login?registered=1` on success.
5. [x] Login page: new success banner gated by `?registered=1`, translated.
6. [x] Translations: `Register` namespace (EN+AR) + `Login.registeredSuccessMessage`.
7. [x] Tests added to `src/lib/users.test.ts` (extended existing
   `registerWithSponsor` describe block + new `validateReferralCode`
   describe block): isMarketer default/explicit-true, duplicate email
   rejected, missing/empty/unknown/suspended ref rejected, valid ref
   accepted with correct sponsor name.
8. [x] Full suite: 562 passed, 1 pre-existing documented reconciliation
   exception (same -27.33841602 drift as prior sessions, confirmed
   unrelated), 1 skipped. `tsc --noEmit` clean.
9. [x] Manual verification EN + AR against the running app: no-ref blocks
   with message (zero form fields rendered), invalid-ref blocks the same
   way, valid-ref renders full form with prefilled read-only referral code
   and "invited by X" line, login success banner renders only with the
   flag, both locales/RTL confirmed. Full registration flow exercised
   end-to-end (sponsor validation -> user created with correct sponsorId +
   isMarketer -> wallets created -> password verifies -> security
   questions stored -> placed in binary tree). Scratch data cleaned up,
   reconciliation re-checked clean (only the known artifact).
10. [ ] Commit and push — next step.
