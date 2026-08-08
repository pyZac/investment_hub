# Phase 11 — Admin Panel

**Goal:** control the simulation. Fully bilingual and RTL-aware, same as the user
dashboard — admin is a real user role, not exempt from the i18n requirement.

**Prerequisites:** Phases 0–9 complete (10 optional at this point).

**Read before starting:** `/docs/build_plan.md` Phase 11 section, the "Admin Roles"
section in Part 3 (permission catalog), and Part 5 (solvency dashboard).

## Deliverables — every section gated by its specific permission

1. **Sub-admin management** *(main-admin-only, not grantable)*: create a sub-admin
   account (email/password, no self-registration), assign and revoke permissions from
   the fixed catalog, deactivate a sub-admin, view a log of each sub-admin's actions.
2. **User management** (`USER_MANAGEMENT`): create user accounts directly, list,
   search, detail view, suspend/reinstate. **No hard delete.**
3. **Withdrawal approval queue** (`WITHDRAWAL_APPROVAL`): list of PENDING Wallet B
   exits, approve/reject with a mandatory comment, full history of past decisions.
4. **Credit issuance to Wallet B** (`CREDIT_ISSUANCE`): the money-creation control,
   with a **mandatory reason field** stored on both the ledger entry and `admin_actions`.
5. **Package management** (`PACKAGE_MANAGEMENT`): create/edit/deactivate packages.
6. **Interest rate management** (`RATE_CONFIG`): edit the global `interest_rate_config`
   — creates a new versioned row effective now, applying uniformly to every active
   investment from the next calculation, with no grandfathering.
7. **Commission rules management** (`COMMISSION_CONFIG`): Direct rate and its 5%/3%
   split, Binary rate, carry-forward expiry — versioned, forward-effective only.
8. **Rank rules management** (`RANK_CONFIG`): per-rank MRV threshold, referral count,
   reward amount/type; add new ranks. Never retroactive to already-granted ranks.
9. **Manual adjustment tool** (`MANUAL_ADJUSTMENT`): creates reversing ledger entries,
   never edits history.
10. **Job monitor** (`JOB_MONITOR`): last run per job type, failures, manual
    re-trigger (safe, because idempotent).
11. **System solvency view** (`SOLVENCY_VIEW`): total credit ever issued by admin,
    total liabilities (all wallet balances + locked capital + pending saving lots),
    the ratio plotted over time, projected obligations for the next 30 days.
12. **Full ledger explorer** (`LEDGER_VIEW`) with filters and CSV export. Every row
    shows: date/time, transaction type as a readable label ("Daily Interest", "Admin
    Credit", "Withdrawal"), user's name, amount, and the comment field.

## Constraints specific to this phase

- **Permission enforcement is server-side per route** (invariant #8). Hiding a button
  in the UI is not enforcement — the underlying route must independently reject an
  unauthorized call made directly against the API. A sub-admin with only
  `WITHDRAWAL_APPROVAL` sees that screen and nothing else.
- Sub-admins can never create further sub-admins. Admin account management is not in
  the grantable catalog.
- `SYSTEM_EXTERNAL` is displayed as **"Platform Reserve"** everywhere in the UI,
  never the raw internal name.
- Every admin financial action writes to `admin_actions` with that specific
  `admin_id` and the mandatory reason.
- Fully bilingual and RTL, same standard as Phase 10.

## Exit test

A sub-admin granted only `WITHDRAWAL_APPROVAL` can reach the approval queue and is
rejected — at the route level, tested by calling the API directly, not just by UI
inspection — from credit issuance, rate config, and ledger export. The main admin
reaches everything with no explicit grants. A credit issuance without a reason is
refused. The solvency view's numbers reconcile against the ledger. The panel is
walked through in Arabic with RTL confirmed.
