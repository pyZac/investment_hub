# Session todo — P2P Wallet B transfer between users

Post-phase feature. Not a numbered build-plan phase; ledger/wallet invariants
(Phase 2) still fully apply.

## Plan (all complete)

1. [x] Schema: added `USER_TRANSFER_SENT` / `USER_TRANSFER_RECEIVED` to
   `LedgerEntryType` enum. Migration generated and read in full — enum-only
   change, no unintended DDL.
2. [x] `src/lib/user-transfer.ts` — `transferBetweenUsers`,
   `searchTransferRecipients`. Distinct from `src/lib/transfers.ts` (the
   existing A→B/C→B self-wallet transfer feature).
3. [x] Self-service recipient search (not admin-gated), excludes self and
   suspended users.
4. [x] New dedicated `/[locale]/transfer` route (chosen over folding into
   withdrawals — different mental model, withdrawals page already has 3
   sections).
5. [x] `transfer/page.tsx`, `actions.ts`, `transfer-form.tsx`,
   `recipient-picker.tsx`, `loading.tsx`. Nav entry added to
   `dashboard-nav.tsx`.
6. [x] `ENTRY_TYPE_LABELS` updated; transactions page/filter pick up the two
   new types automatically (both derive from the shared label map).
7. [x] Translations added (EN+AR), `Nav.transfer` key added. Verified RTL
   live: `dir="rtl"` set, Wallet B stays untranslated, amounts stay Western
   numerals via `dir="ltr"` wrapper.
8. [x] Tests: `src/lib/user-transfer.test.ts`, 12 tests — insufficient
   balance, suspended recipient, suspended sender, self-transfer,
   below-minimum, non-existent recipient, valid transfer (both ledger sides
   + balances), idempotency replay, recipient search (self-exclusion,
   suspended-exclusion, name/email match, blank query). All pass in
   isolation.
9. [x] Full suite run: 543 passed, 1 pre-existing documented exception
   (`reconciliation.test.ts`'s known -27.33841602 SYSTEM_EXTERNAL drift,
   see 2026-09-08/09 lessons.md entry — confirmed unrelated by re-running
   against the pre-change code via `git stash`, same exact drift amount).
   `tsc --noEmit` clean.
10. [x] Manual live verification (EN + AR): real users, real session
    cookies, full stack (search -> transfer -> both sides' transaction
    history) exercised against the running app container. Cleaned up
    afterward; reconciliation re-checked, no new drift introduced.
11. [ ] Commit and push — next step.

## Open decision resolved without asking (reasonable default per Auto Mode)
- Dedicated `/transfer` page rather than folding into `/withdrawals`, since
  this is peer-to-peer (fundamentally different mental model from
  self-withdrawal) and withdrawals is already a 3-section page.
