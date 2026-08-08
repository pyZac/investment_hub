# Investment Webapp Simulation — Build Plan

> **Companion documents**: `mlm_rules_log.md` (Direct/Binary/Ranking commission rules), `wallet_interest_audit_rules_log.md` (packages, interest, withdrawals, audit).
>
> **Project nature**: Closed internal simulation. No payment gateway, no external APIs, no real money. Admin credit issuance to Wallet B is the only source of funds entering the system.
>
> **How to use this file**: Each phase below is sized to be one Claude Code session. Do not skip ahead — later phases depend on invariants established earlier. Feed this file plus the two rules files into the project context at the start of every session.

---

## Part 1 — Tech Stack

### Recommended Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | **Next.js 15 (App Router) + TypeScript** | One deployable unit (API + UI), server actions, good server story |
| Database | **PostgreSQL 16** | Non-negotiable — see precision note below |
| ORM | **Prisma** | First-class `Decimal` support, migration history, type safety |
| Auth | **Auth.js (credentials provider)** or **Lucia** | Local username/password, no external identity provider |
| Styling | **Tailwind CSS + shadcn/ui** | Fast path to a polished dashboard |
| Charts | **Recharts** | Profit curves, wallet history, volume charts |
| Tree visualization | **react-d3-tree** or custom **D3** | Binary placement tree |
| Background jobs | **node-cron** in a separate worker process | Daily interest, Friday payouts, weekly binary, monthly rank |
| Validation | **Zod** | Shared schema validation client + server |
| Internationalization | **next-intl** | Route-based locale switching (`/en`, `/ar`), message catalogs, RTL-aware |
| Testing | **Vitest** | Engine logic must be unit-tested |
| Deployment | **Docker Compose** (app + worker + Postgres) | Portable to any VPS |

### Bilingual (English / Arabic) requirement

The app must fully support **English and Arabic**, including:
- All UI text, labels, buttons, emails/notifications (if added later), and admin panel — translated, not just the user-facing dashboard
- **RTL (right-to-left) layout** for Arabic — this is a real layout mode, not just mirrored text. Tailwind's `rtl:`/`ltr:` variants plus `dir="rtl"` on the root handle most of it, but custom components (charts, the binary tree visualization, wallet cards) need explicit RTL testing, since libraries like Recharts and D3 don't auto-flip.
- **Numbers stay in the same format regardless of language** — display all monetary values as standard Western Arabic numerals (0–9) in both locales, not Eastern Arabic numerals, so amounts remain unambiguous and consistent for audit/support purposes. Only labels, dates (consider whether to localize date format), and surrounding text translate.
- Locale is user-selectable (persisted per user, e.g. a `locale` column or preference), with a language switcher in the header, defaulting to a configurable app-wide default.
- Recommended approach: **next-intl** with route-based locales (`/en/dashboard`, `/ar/dashboard`), JSON message catalogs per language (`messages/en.json`, `messages/ar.json`), maintained from day one — retrofitting translations after the UI is built is far more expensive than building bilingual from Phase 0 onward.
- **Domain/financial terminology stays in English even in the Arabic UI** — terms like "Wallet A/B/C", "Binary Commission", "Direct Commission", "Rank", "BV", package names, etc. are **not translated**, only general interface text, instructions, labels, and navigation are. This matches common practice on regional platforms and avoids ambiguity around specialized terms that don't have a single settled Arabic equivalent. Keep a short glossary list in the translation catalog itself (e.g. a comment block) so this stays consistent as new UI is added in later phases.

### Critical: Why PostgreSQL and not SQLite

Your spec requires **8 decimal places stored**. SQLite has no true decimal type — it stores `REAL` as float64, which introduces rounding drift. In a compounding-interest system that runs daily for months, that drift accumulates and your audit ledger will not reconcile.

Use PostgreSQL `NUMERIC(24, 8)` for **every** monetary column. In Prisma: `@db.Decimal(24, 8)`. In application code, never use JavaScript `number` for money — use `Prisma.Decimal` (decimal.js) end to end. Convert to a display string only at the last render step.

**Rule to enforce from day one:** no money value is ever a JS `number`. Add an ESLint rule or code review checklist item for this.

---

## Part 2 — Core Architectural Decisions

These three decisions shape everything. Get them right in Phase 2 and the rest is mechanical.

### Decision 1: Double-Entry Ledger as the Source of Truth

Your audit requirement ("permanent audit history", record everything) is best served by making the **ledger the source of truth**, not the balance columns.

```
ledger_entries (immutable, append-only)
├── id
├── user_id         (nullable — NULL for the SYSTEM_EXTERNAL account)
├── wallet          (A | B | C | SAVING | SYSTEM_EXTERNAL)
├── direction       (CREDIT | DEBIT)
├── amount          NUMERIC(24,8)  -- always positive
├── entry_type      (ADMIN_CREDIT | PACKAGE_PURCHASE | DAILY_INTEREST |
│                    DIRECT_COMMISSION | DIRECT_SAVING | BINARY_COMMISSION |
│                    RANK_REWARD | WITHDRAWAL_OUT | WITHDRAWAL_IN |
│                    CAPITAL_RELEASE | SAVING_UNLOCK | ADMIN_ADJUSTMENT)
├── reference_type  (investment | commission | rank_award | withdrawal | ...)
├── reference_id
├── comment         text (nullable) -- human-readable note; auto-filled for system-generated entries, freeform for admin actions
├── idempotency_key UNIQUE  -- see Decision 2
├── metadata        JSONB
└── created_at
```

Rules:
- **No UPDATE, no DELETE, ever.** Corrections are new reversing entries.
- Every money movement writes **two** entries (debit one wallet, credit another) inside one DB transaction, **with no exceptions** — including money entering and leaving the simulation.
- **`SYSTEM_EXTERNAL` counterparty account**: a special non-user ledger account representing "outside the simulation." Admin credit issuance is CREDIT user's B / DEBIT `SYSTEM_EXTERNAL`. Withdrawal burn out of Wallet B is DEBIT user's B / CREDIT `SYSTEM_EXTERNAL`. This keeps every entry double-sided with no special-cased single-sided writes, and makes the solvency dashboard (Part 5) a simple query: `SUM(SYSTEM_EXTERNAL debits) − SUM(SYSTEM_EXTERNAL credits)` = net money ever created into the system.
  - **`SYSTEM_EXTERNAL` is the internal/database name only.** In the admin dashboard, display it under a human-readable label instead — e.g. **"Platform Reserve"** or **"External Vault"** (pick one; used consistently everywhere in the UI). The technical name stays in code/schema; only the label shown to the admin changes.
- `wallets.balance` exists as a **cached** column for read performance, updated in the same transaction. A nightly reconciliation job asserts `SUM(ledger) == wallets.balance` for every user (including `SYSTEM_EXTERNAL`) and alarms on mismatch.

This single decision gives you the audit trail, makes bugs visible instead of silent, and lets you rebuild any balance from scratch.

### Decision 2: Idempotency and Catch-Up (because you chose real clock)

You chose real clock only. That means the server *will* be down at some point when a job should have run — a restart, a deploy, a crash. Without protection you get **missed days** (users lose profit) or **double-runs** (users get paid twice).

Solution — two parts:

**a) Idempotency keys.** Every generated entry carries a deterministic unique key:
```
daily_interest:{user_id}:{investment_id}:{YYYY-MM-DD}
binary:{user_id}:{cycle_week_start}
rank_reward:{user_id}:{rank}
direct:{investment_id}
```
A `UNIQUE` constraint on `idempotency_key` makes double-payment **impossible at the database level**, not merely unlikely. Re-running any job is then always safe.

**b) Catch-up logic.** Jobs do not ask "what is today?" — they ask "what periods are unprocessed?" A `job_runs` table records the last successfully processed period per job type. On startup and on each tick, the job processes every missing period from last-completed to now, in order.

This means a server that was off for three days will correctly credit three days of interest on restart.

### Decision 3: Time Handling

- **Timezone**: all business logic runs on **UAE time (Asia/Dubai, UTC+4)** — set this explicitly in config (`TIMEZONE=Asia/Dubai`), not server local time. "Friday", "month boundary", and the Saturday–Friday binary cycle all resolve against this timezone. Since UTC+4 has no DST, this is a fixed offset and won't shift throughout the year — but store it as a named timezone (not a raw `+04:00` offset) so date libraries handle it correctly.
- **All engine functions are pure and take the date as a parameter**:
  ```ts
  calculateDailyInterest(investment, walletABalance, forDate: Date): Decimal
  runBinaryCycle(userId, cycleStart: Date, cycleEnd: Date): BinaryResult
  ```
  This is not a "time travel" feature in the product — it is just testable design. It lets your test suite verify a simulated year of behaviour in seconds, while production still passes the real `new Date()`. You get correctness confidence without waiting real weeks.
- The scheduler passes real dates. The tests pass fabricated dates. Same code path.

### Decision 4: Business Rules Are Admin-Editable, But Versioned

The admin needs to edit package definitions, interest rates, commission percentages, and rank thresholds/rewards without redeploying code. But these values drive money calculations that have already happened — so a plain "edit in place" would silently rewrite history and break the immutable ledger's meaning.

**Rule:** every editable business parameter is stored with an **effective date range**, not a single current value. Editing a rule doesn't overwrite the old row — it closes the old row's validity window and inserts a new one starting now.

```
interest_rate_config
├── id, monthly_rate, effective_from, effective_to (nullable = still active)
```

There is **one active interest rate at any given moment**, applying uniformly to every user's active investments — not a rate locked in per investment. If the admin changes the rate, the change takes effect for **everyone's accrual starting the next calculation**, with no grandfathering of old investments at an old rate. This is intentionally simple: rate changes are expected to be rare (annual, at most), and per-investment rate-locking was considered and rejected as unnecessary complexity for how this admin control will actually be used.

Engine functions still take a date parameter (Decision 3) and look up "which rate was active on that date" — this makes historical calculations reproducible (a day in February always used February's rate, even if queried today), but the lookup result applies to **all** active investments for that day, not to a rate frozen at each investment's purchase time.

Commission rates and rank thresholds work the same versioned way:

```
commission_config
├── id, direct_rate, direct_commission_split, direct_saving_split,
│   binary_rate, binary_carry_forward_expiry_months (default 6),
│   effective_from, effective_to

rank_config
├── id, rank_name, mrv_required, direct_referrals_required,
│   reward_amount, reward_type (CASH | CASH_OR_TRIP), rank_order,
│   effective_from, effective_to
```

**Packages** are simpler than rates: they're discrete products (name + amount), not a versioned number, and they don't carry their own interest rate at all — interest is governed entirely by the single global `interest_rate_config` above. Packages support standard CRUD (create, edit, deactivate) directly; deactivating a package just hides it from future purchases and never touches investments already made under it.

**User deletion:** hard delete is **not supported**, for two reasons — it would orphan ledger entries that reference the user (breaking immutability), and it would break both tree structures (sponsor tree and placement tree) for any downline the user has. Instead, admin gets a **suspend/deactivate** action: the user cannot log in or transact, but stays in the system, preserving audit history and tree integrity. This is the standard, safe pattern for this kind of system.

---

## Part 3 — Data Model

### Two Separate Trees (do not conflate)

| Tree | Used for | Depth that matters | Structure |
|------|----------|-------------------|-----------|
| **Sponsor tree** | Direct commission, Rank MRV, Rank referral count | 1 level only | `users.sponsor_id` |
| **Placement tree** | Binary commission, BV rollup | Unlimited | `binary_nodes` |

`users.sponsor_id` and the placement parent are **independent** — a user sponsored by X may be placed under Y via spillover.

### Schema Outline

```
users
├── id, email, password_hash, name
├── role              (USER | ADMIN)
├── is_main_admin     boolean, default false — exactly one user ever has this set true (seeded).
│                        The main admin implicitly has every permission and is the only one who
│                        can create/edit/deactivate other admin accounts (see admin_permission_grants).
├── created_by_admin_id → users.id (nullable) — which admin created this account, if it's a sub-admin
├── sponsor_id        → users.id   (referral tree, nullable for root)
├── locale            (en | ar) — default configurable, user-switchable
├── suspended_at      (nullable) — full financial freeze when set, see Phase 5/8 note
├── created_at

admin_permission_grants   -- what each sub-admin is allowed to do
├── admin_user_id     → users.id
├── permission        (enum — see catalog below)
└── UNIQUE(admin_user_id, permission)

binary_nodes
├── user_id           → users.id (1:1)
├── parent_id         → binary_nodes.user_id (nullable for root)
├── position          (LEFT | RIGHT)
├── path              text  -- materialized path e.g. '/1/4/9/'
├── depth             int

packages           -- admin-editable via CRUD; seed with 7 initial tiers
├── id, name, amount, is_active
├── created_at, deactivated_at (nullable — deactivating hides from new purchases,
│   existing investments under this package are unaffected)
-- Note: packages do NOT carry their own interest rate. Interest rate is a single
-- global value (interest_rate_config, above), applied uniformly to every active
-- investment regardless of which package or when it was purchased.

investments
├── id, user_id, package_id, amount
├── purchased_at
├── profit_starts_at      = purchased_at + 7 days
├── capital_unlocks_at    = purchased_at + 6 months
├── capital_released_at   (nullable)
├── status                (ACTIVE | CAPITAL_RELEASED)

wallets
├── user_id, type (A | B | C | SAVING), balance NUMERIC(24,8)
└── UNIQUE(user_id, type)

ledger_entries        -- see Decision 1

saving_lots           -- the locked 3% from direct commission
├── id, user_id, amount, source_investment_id
├── created_at, unlocks_at (= created_at + 3 months)
├── released_at (nullable)

bv_entries            -- binary volume, one row per (ancestor, purchase)
├── id, ancestor_user_id, source_investment_id
├── leg (LEFT | RIGHT), amount
├── cycle_week_start
└── UNIQUE(ancestor_user_id, source_investment_id)

binary_cycles         -- weekly snapshot per user
├── user_id, week_start, week_end
├── left_volume, right_volume        (incl. carried-in)
├── matched_volume, commission_paid
├── carry_left, carry_right          (out to next week)
├── carry_left_since, carry_right_since  -- the week_start when the currently-carried
│   balance first appeared unmatched; reset to this cycle's week_start whenever that
│   side is fully matched (drops to 0) or newly created; used to compute expiry age
├── qualified boolean, qualification_reason
└── UNIQUE(user_id, week_start)

mrv_periods           -- monthly rank volume
├── user_id, month (YYYY-MM)
├── volume, qualified_direct_referrals
└── UNIQUE(user_id, month)

rank_awards
├── user_id, rank, achieved_month
├── reward_amount, reward_choice     (CASH | TRIP, for Partner)
├── credited_at (nullable)
└── UNIQUE(user_id, rank)            -- enforces once-only

wallet_transfers       -- self-service A→B and C→B, Friday-only, instant, no approval
├── id, user_id, from_wallet (A | C), amount, requested_at, processed_at

withdrawal_requests    -- Wallet B exit ("burn"), requires admin approval
├── id, user_id, amount, status (PENDING | APPROVED | REJECTED)
├── requested_at, decided_at, decided_by_admin_id, admin_comment

job_runs
├── job_type, period_key, status, started_at, completed_at, error
└── UNIQUE(job_type, period_key)

admin_actions         -- every admin financial action
├── id, admin_id, action_type, target_user_id, amount, reason, created_at
```

### Admin Roles: Main Admin + Permissioned Sub-Admins

- **Main admin**: exactly one account, seeded at setup (`is_main_admin = true`). Implicitly has every permission — never needs explicit grants, and permission checks always short-circuit to "allowed" for this account. Only the main admin can create, edit, deactivate, or change permissions for other admin accounts — sub-admins cannot create further sub-admins, even if they somehow had that permission granted, to avoid privilege-escalation chains.
- **Sub-admins**: created only by the main admin (no self-registration for any admin role). Each sub-admin gets a login and an explicit set of permissions chosen from a fixed catalog:

| Permission | Grants access to |
|---|---|
| `CREDIT_ISSUANCE` | Issue Wallet B credit to users |
| `WITHDRAWAL_APPROVAL` | Approve/reject Wallet B-exit requests |
| `USER_MANAGEMENT` | Create user accounts, view/search users, suspend/reinstate accounts, manual password reset |
| `PACKAGE_MANAGEMENT` | Create/edit/deactivate packages |
| `RATE_CONFIG` | Edit the interest rate config |
| `COMMISSION_CONFIG` | Edit Direct/Binary commission rates and splits |
| `RANK_CONFIG` | Edit rank thresholds and rewards |
| `LEDGER_VIEW` | Read-only access to the full ledger explorer and CSV export |
| `MANUAL_ADJUSTMENT` | Create reversing/correction ledger entries |
| `JOB_MONITOR` | View and manually re-trigger scheduled jobs |
| `SOLVENCY_VIEW` | View the system solvency dashboard |

  *(Admin account management itself — creating/editing sub-admins and their permissions — is not in this list; it is exclusively main-admin-only and not grantable.)*

- **Enforcement**: route/action-level middleware checks the specific permission required, not just "is this user an admin." A sub-admin with only `WITHDRAWAL_APPROVAL` sees just that screen in the admin panel — other admin sections are hidden/blocked, not merely greyed out.
- **Accountability**: every action a sub-admin takes still writes to `admin_actions` with their specific `admin_id` (already part of the schema) — the main admin can always see which sub-admin did what, when, and why (via the mandatory comment field established earlier).

---

## Part 4 — Build Phases

Each phase = one Claude Code session. **Do not start a phase before its predecessor's tests pass.**

---

### Phase 0 — Foundation
**Goal:** empty app that boots, connects to Postgres, and deploys.

- Next.js + TypeScript + Tailwind + shadcn/ui scaffold
- **next-intl scaffolding**: route-based locales (`/en`, `/ar`), empty `messages/en.json` and `messages/ar.json` catalogs, `dir="rtl"` wired to the Arabic locale, language switcher stub in the layout. Set this up now — every component built in later phases should use translation keys from day one, not hardcoded English strings retrofitted later.
- Docker Compose: `app`, `worker`, `postgres`
- Prisma initialised, connection verified
- ESLint/Prettier, Vitest configured
- `.env` handling, config module with `TIMEZONE`, `MIN_WITHDRAWAL`, rates
- Health check route

**Exit test:** `docker compose up` gives a running app + reachable DB.

---

### Phase 1 — Auth & Users
**Goal:** users can register/login; admin role exists.

- User model, password hashing (**argon2id**, per Part 7)
- **Three account-creation paths**: (1) self-registration with a sponsor referral code, (2) self-registration with no code — creates a new **tree root** (both sponsor tree and placement tree), intended for the first user in practice but not hard-blocked at the schema level, (3) **admin-created user accounts** — admin can create a user account directly on a user's behalf (sets initial password, optionally assigns a sponsor), logged to `admin_actions`
- **Security questions** captured at registration (2–3 questions, hashed answers) — used for self-service password reset. For admin-created accounts, security questions are set on the user's first login.
- **Admin manual password reset** — admin panel action to reset any user's password directly, logged to `admin_actions` (no email/SMS exists to support a token-based reset flow)
- Session handling with **`httpOnly` / `secure` / `sameSite=strict` cookies**; shorter idle timeout for admin sessions than user sessions
- **Rate limiting + lockout** on login, password reset, and security-question endpoints
- **Mandatory 2FA (TOTP) for all admin and sub-admin accounts** — optional for regular users
- **Permission-based route guard**: checks specific `admin_permission_grants` for sub-admins, always allows the main admin (`is_main_admin = true`) through every admin route
- Seed script: one **main admin** account (`is_main_admin = true`), no permission grants needed for it

**Exit test:** register two users, one under the other's referral link; register a third with no code (becomes a root); login as both; admin route blocked for normal users; user resets password via security questions; admin resets a user's password manually; main admin can reach every admin route with no explicit grants; repeated failed logins trigger lockout; admin login requires a valid TOTP code after password.

---

### Phase 2 — Ledger & Wallets ⭐ *Most important phase*
**Goal:** the money primitive. Everything later calls into this.

- `ledger_entries` table with `idempotency_key UNIQUE`, append-only enforced (revoke UPDATE/DELETE at DB role level if possible)
- 4 wallets auto-created per user on registration (A, B, C, SAVING)
- Core service: `postTransaction({ entries[], idempotencyKey })` — validates debits == credits, writes entries + updates cached balances, all in one DB transaction
- Admin credit issuance: `adminCreditWalletB(userId, amount, reason)` — the only money-creation point, logs to `admin_actions`
- Reconciliation job: `SUM(ledger) == wallets.balance` per user
- Decimal helpers: `toDisplay(d)` → 2dp string; never `Number()`

**Exit test:** admin credits $1,000 to a user's B wallet; ledger and balance agree; re-running with the same idempotency key creates nothing new; reconciliation passes.

---

### Phase 3 — Packages & Purchase
**Goal:** user turns Wallet B credit into an active investment; admin can manage package tiers.

- Seed 7 fixed packages ($100 → $100,000) — starting data, not hardcoded constants. Packages carry name/amount only; interest rate is **not** a package property (see Phase 4 and Decision 4 — one global rate applies to everyone).
- **Admin package CRUD**: create, edit (amount, name), deactivate a package. Deactivating hides it from new purchases but never touches existing investments.
- Purchase flow: validate B balance ≥ package amount → ledger: DEBIT B / CREDIT A → create `investment` with `profit_starts_at` (+7d) and `capital_unlocks_at` (+6mo)
- Package list UI + purchase confirmation
- "My investments" view showing lock countdowns

**Exit test:** user with $1,000 in B buys the $1,000 package; B = 0, A = 1,000; investment row has correct dates; buying with insufficient funds is rejected.

---

### Phase 4 — Daily Interest Engine
**Goal:** Wallet A grows daily, at one uniform rate shared by every user's active investments.

- Pure function: `dailyRate(date) = activeMonthlyRate(date) / daysInMonth(date)` — looks up the **currently active `interest_rate_config` row for that date** (per Decision 4), not a per-investment or per-package value. Every active investment across every user accrues at the same rate on the same day; a rate change takes effect for all of them starting the next calculation, with no grandfathering.
- Confirmed compounding behavior (per earlier discussion): interest compounds daily on the running balance, and the ~4 skipped Fridays per month mean the effective monthly total lands around ~4.3% rather than exactly 5% — this is accepted as intended, not a bug to fix.
- Accrual rules, evaluated **per investment** (each investment still tracks its own dates individually, even though the rate itself is shared):
  - Skip if `date < investment.profit_starts_at`
  - **Skip if the date is a Friday**
  - Skip entirely if the investment's owner is suspended (Phase 5)
  - Base = **that investment's own current running balance** (its principal + its own accrued profit so far) — summing every investment's balance gives the user's total Wallet A balance
- Cron: daily at 00:05 in the configured timezone
- Catch-up: process every unprocessed date since last run
- Idempotency key: `daily_interest:{user_id}:{investment_id}:{date}`
- Write to ledger as `DAILY_INTEREST` credit to A, tagged to the specific investment via `reference_id`

**Exit test:** unit tests running 90 fabricated days verify: nothing before day 8, no Friday accrual, compounding on each investment's own running balance, exact expected totals to 8dp; a simulated rate change mid-test correctly changes the very next day's accrual for **every** active investment, not just ones purchased after the change.

---

### Phase 5 — Withdrawals
**Goal:** A→B and C→B self-service on Fridays; B-exit requires admin approval; capital release after 6 months.

- Friday-only guard (server-side, based on configured timezone — never trust the client) applies to **both** flows below
- **A→B and C→B (self-service, instant)**: no admin approval needed. A→B withdraws **profit only** while capital is locked. Requires tracking the capital portion of Wallet A per investment so profit = `A_balance − locked_capital`. C→B withdraws the full commission wallet balance minus anything still in SAVING. Both write to `wallet_transfers` and post directly through the ledger.
- **B-exit ("burn", requires approval)**: user submits a `withdrawal_requests` row (status `PENDING`), $50 minimum enforced at submission. Admin reviews in the admin panel and approves or rejects (with a comment). Only on **approval** does the ledger post: DEBIT user's B / CREDIT `SYSTEM_EXTERNAL`. Rejection leaves Wallet B untouched and records the admin's reason.
- SAVING unlock job: `saving_lots` past `unlocks_at` become withdrawable (release into C)
- Capital release: after `capital_unlocks_at`, user may move capital A→B (self-service, Friday-only, same as profit — no approval needed for this step, approval is only required at the final B-exit); investment status → `CAPITAL_RELEASED`; it stops earning
- **Suspension check**: if a user is suspended (`suspended_at` set), block all withdrawal/transfer actions and — critically — the interest/commission engines (Phase 4, 6, 8, 9) must also check this flag and skip accrual entirely for suspended users. A suspended user's leg is treated as inactive for anyone whose binary tree includes them.
- Withdrawal UI: disabled with a countdown on non-Fridays; B-exit shows pending/approved/rejected status to the user

**Exit test:** A→B/C→B transfers process instantly on Friday with no approval step; rejected Sat–Thu. A $200 B-exit request sits `PENDING` until admin approves it, at which point Wallet B decreases and `SYSTEM_EXTERNAL` reflects it; a rejected request leaves B untouched. $49 B-exit request rejected at submission. Capital withdrawal blocked at month 5, allowed at month 6. A suspended user's investment accrues zero interest the day after suspension, and their leg's active status flips to inactive for their upline.

---

### Phase 6 — Sponsor Tree & Direct Commission
**Goal:** 8% to the direct sponsor, split 5% / 3%, on a referral's first purchase only.

- Sponsor relationship finalised at registration (`users.sponsor_id`)
- Trigger: **only the buyer's first-ever package purchase** (track via `investments.is_first_purchase` or by checking if it's the buyer's earliest investment). Subsequent purchases by the same user — including reinvestments funded by their own profit/commission — do **not** re-trigger Direct Commission.
- On that qualifying first purchase, if the buyer has a sponsor, read the **currently active `commission_config`** row (admin-editable, versioned per Decision 4) for the direct rate and 5%/3% split, then:
  - 5% (or current configured split) → CREDIT sponsor's Wallet C (immediately available)
  - 3% (or current configured split) → CREDIT sponsor's SAVING wallet + create `saving_lot` with `unlocks_at = now + 3 months`
- One level only — no upline propagation
- Idempotency key: `direct:{investment_id}`
- UI: referral link, direct referrals list, commission history

**Exit test:** referral's first $10,000 purchase → sponsor's C +$500, SAVING +$300; that same referral's second purchase (any amount, any funding source) generates **no** Direct Commission; sponsor's sponsor receives nothing.

---

### Phase 7 — Placement Tree & BV Rollup
**Goal:** the binary tree structure and volume propagation.

- Placement algorithm on registration: BFS from the **sponsor's node** downward, find the first open slot on the side with **less accumulated BV** (confirmed — weaker leg is BV-based, not member-count-based)
  - Requires querying/caching summed BV per subtree at insertion time — consider a maintained per-node BV total rather than summing the whole subtree on every registration
  - If both legs are equal/empty, either side is acceptable (per spec)
- Materialized `path` maintained on insert for fast ancestor queries
- BV rollup on purchase: walk from buyer to root; for each ancestor, determine which of its two legs contains the buyer (read from `path`), insert a `bv_entry` for that ancestor+leg+amount
- **Only package purchases generate BV** — never profits, commissions, rank rewards, or transfers
- Tree visualization component (this is where `react-d3-tree` earns its keep)

**Exit test:** build a 4-level tree; a purchase at the bottom creates BV entries for every ancestor on the correct leg; a commission credit creates none.

---

### Phase 8 — Binary Cycle Engine
**Goal:** weekly weak-leg payout with carry-forward, with expiry on volume that never gets matched.

- Cycle window: **Saturday 00:00 → Friday 23:59** (configured timezone)
- For each user at cycle close:
  1. `left_total = carry_left_in + bv this cycle on left`, same for right
  2. Qualification: user has an active investment **and** both legs are active (a leg is active if *any* member in that subtree currently holds capital in Wallet A **and is not suspended** — this is a **live/dynamic** status: releasing capital, or an admin suspending a user, can flip a leg from active back to inactive, so re-evaluate on every capital release and every suspension/reinstatement event, not just on deposit)
  3. If qualified: `matched = min(left, right)`, `commission = matched × currently active binary_rate` (from `commission_config`, admin-editable per Decision 4 — default 8%) → CREDIT Wallet C, fully available
  4. Carry forward: `carry_left = left − matched`, `carry_right = right − matched` (one of these is always 0)
  5. If **not** qualified: no payout, but volume still carries forward in full
  6. **Carry-forward expiry**: track how long the currently-carried balance on each side has gone unmatched (`carry_left_since`/`carry_right_since`, reset to the current `week_start` whenever that side fully matches down to 0). If a side's carry has been sitting unmatched for longer than `binary_carry_forward_expiry_months` (from `commission_config`, admin-editable, default 6 months), that stale portion is dropped — it does not carry into the next cycle and is not paid. This prevents one side of a permanently-imbalanced tree from accumulating an unbounded number indefinitely.
- Write a `binary_cycles` row per user per week — this is the audit record and the UI data source
- Idempotency key: `binary:{user_id}:{week_start}`
- Rank rewards are also credited on the Friday cycle (see Phase 9)

**Exit test:** the spec example — Left 15,000 / Right 7,000 → pay 8% × 7,000 = 560; next cycle opens Left 8,000 / Right 0. Plus: unqualified user accrues carry but is paid nothing. Plus: a left-leg carry that sits unmatched for longer than the configured expiry window (default 6 months of weekly cycles) is dropped rather than carried indefinitely; a leg that matches at any point before expiry resets its age counter.

---

### Phase 9 — MRV & Ranking Engine
**Goal:** monthly rank evaluation, one-time rewards, thresholds/rewards admin-editable.

- MRV accrual: **every** package purchase by a direct referral counts — new purchases and reinvestments alike, no first-purchase-only restriction. This is a deliberate difference from Direct Commission (which only fires on a referral's first-ever purchase, per Phase 6) — the two systems intentionally use different triggers. Add the purchase amount to the **direct sponsor's** current-month MRV. **Depth = 1 level only** — this is also deliberately different from Binary Commission's unlimited rollup.
- Monthly reset: MRV starts at 0 on the 1st, no carry forward
- Qualified direct referral count = directly sponsored users holding an active investment
- **Evaluation reads the currently active `rank_config` rows** (admin-editable, versioned per Decision 4 — see the 8 ranks/thresholds/rewards already defined as seed data): when both thresholds are met in the same month, grant the rank **immediately**; queue the reward for the next Friday cycle. A rank threshold change only affects evaluations going forward — a rank already granted stays granted regardless of later config edits.
- **Admin rank CRUD**: edit MRV threshold, referral count, reward amount/type per rank, or add new ranks above OG. Cannot edit a rank's requirements retroactively for users who already earned it (the award itself is a permanent historical fact, per `rank_awards.UNIQUE(user_id, rank)`).
- Award **only the highest newly-achieved rank** in that month
- `rank_awards` has `UNIQUE(user_id, rank)` — enforces once-ever at the DB level
- Ranks are permanent, never downgraded
- Reward credited to Wallet C, fully available, **no** saving split
- Partner rank: user chooses cash ($2,000, or currently configured amount) or trip — store the choice; trip = non-cash, log it without a ledger credit

**Exit test:** user with 4 qualified referrals and 100,000 MRV in one month → Partner granted immediately, $2,000 credited next Friday, Investor's $500 **not** also paid; repeating the same performance next month pays nothing.

---

### Phase 10 — User Dashboard (the polished layer)
**Goal:** the experience you described — daily profit visible and satisfying.

- Overview: four wallet cards (A / B / C / SAVING) with animated count-up on daily profit
- Profit chart: daily accrual over time (Recharts area chart), Friday gaps visible
- Investments panel: each package with lock countdown rings (6-month capital, 7-day profit start)
- Binary panel: left/right volume bars, carry-forward indicator, qualification status, next-cycle countdown
- Interactive placement tree visualization
- Rank progress: current rank badge, next rank requirements with dual progress bars (MRV + referrals)
- Referral centre: link, QR, direct referrals table, commission breakdown
- Withdrawal page: Friday-aware, countdown when closed
- Transaction history with filters, 2-decimal display throughout
- **Bilingual pass**: every string routed through `next-intl` translation keys; full Arabic translation of all Phase 10 UI text; **RTL layout verified specifically** for the tree visualization, charts, and wallet cards (these don't auto-flip and need manual RTL styling); language switcher in the header, wired to the persisted user preference

**Design note:** load the `frontend-design` skill in Claude Code for this phase.

---

### Phase 11 — Admin Panel
**Goal:** control the simulation. **Also fully bilingual (English/Arabic) and RTL-aware, same as the user dashboard** — admin is a real user role, not exempt from the i18n requirement. **Every section below is gated by its corresponding permission** (see the RBAC design in Part 3) — a sub-admin only sees sections they've been granted.

- **Sub-admin management** *(main-admin-only, not grantable)*: create a sub-admin account (email/password, no self-registration), assign/revoke permissions from the fixed catalog, deactivate a sub-admin, view a log of each sub-admin's actions
- User management: **create user accounts directly**, list, search, detail view, **suspend/deactivate** (no hard delete — see Decision 4 for why; suspension is a full financial freeze per Phase 5, not just an access block) — requires `USER_MANAGEMENT`
- **Withdrawal approval queue**: list of `PENDING` Wallet B-exit requests, approve/reject with a mandatory comment, full history of past decisions — requires `WITHDRAWAL_APPROVAL`
- **Credit issuance to Wallet B** — the money-creation control, with a **mandatory comment/reason field** (stored both on the ledger entry and in `admin_actions`) so every credit is traceable to why it was issued — requires `CREDIT_ISSUANCE`
- **Package management**: create/edit/deactivate packages (name, amount, rate) — full CRUD, per Phase 3 — requires `PACKAGE_MANAGEMENT`
- **Interest rate management**: edit the global `interest_rate_config` — creates a new versioned row effective now; applies uniformly to **every** active investment's accrual starting the next calculation (no grandfathering of old investments at an old rate) — requires `RATE_CONFIG`
- **Commission rules management**: edit `commission_config` — Direct Commission rate and its 5%/3% split, Binary Commission rate — versioned, takes effect going forward only — requires `COMMISSION_CONFIG`
- **Rank rules management**: edit `rank_config` — per-rank MRV threshold, referral count, reward amount/type, or add new ranks — versioned, never retroactive to already-granted ranks — requires `RANK_CONFIG`
- Manual adjustment tool (creates reversing ledger entries, never edits history) — requires `MANUAL_ADJUSTMENT`
- Job monitor: last run per job type, failures, manual re-trigger (safe — idempotent) — requires `JOB_MONITOR`
- **System solvency view** — see Part 5 below — requires `SOLVENCY_VIEW`
- Full ledger explorer with filters and CSV export — every row must clearly show: **date/time, transaction type (readable label, e.g. "Daily Interest", "Admin Credit", "Withdrawal"), user's name, amount, and the comment/note field.** System-generated entries auto-fill the comment (e.g. "Daily interest for Investment #123, day 14"); admin-issued entries require the admin to type a reason, which is stored as the comment. Requires `LEDGER_VIEW`.
- Counterparty account (`SYSTEM_EXTERNAL`) is shown under its friendly display label (see Part 2, Decision 1) everywhere in this explorer, never the raw internal name.

---

### Phase 12 — Audit, Reconciliation & Security Hardening
**Goal:** integrity checks and the security controls from Part 7 that aren't already built into earlier phases.

- Nightly reconciliation: ledger sum vs cached balances, alarm on drift (also acts as tamper detection, not just bug detection)
- Invariant checks: no negative balances, no orphan tree nodes, no duplicate idempotency keys
- Per-user statement export (CSV/PDF)
- **Security event logging**: failed logins, account lockouts, permission grant/revoke, admin account creation, 2FA enrollment/removal — logged with the same clarity as financial events
- **Security headers**: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` — via Next.js middleware/config
- **Dependency audit**: `npm audit` in CI, lockfile enforced, Dependabot/Renovate enabled
- Grep/lint check confirming no `$queryRawUnsafe`/`$executeRawUnsafe` usage anywhere in the codebase
- Backup strategy for Postgres

**Note:** auth-layer security (password hashing, rate limiting, 2FA, session cookie flags) is built in Phase 1, not here — this phase covers what only becomes checkable once the full system exists. See Part 7 for the complete security architecture and which phase owns each control.

---

### Phase 13 — Deployment
- Docker Compose production profile
- Nginx/Caddy reverse proxy + TLS
- Postgres backups (`pg_dump` on cron, off-box copy)
- Worker process supervised and auto-restarting
- Structured logging, error tracking
- Deployment runbook

---

## Part 5 — Two Things to Watch During the Experiment

### 1. The system is mathematically insolvent by design

Total outflow per $100 of package sales:
- ~5%/month compounding to the investor (~80%/year)
- 8% direct commission
- 8% binary commission on matched volume
- Rank rewards up to $2,000,000

Inflow: **admin credit issuance only.** There is no revenue source in the model.

For a simulation this is fine — but it is the most interesting variable in your experiment, so instrument it. Build a **solvency dashboard** in Phase 11 tracking:
- Total credit ever issued by admin
- Total liabilities (sum of all wallet balances + locked capital + pending saving lots)
- Ratio, plotted over time
- Projected obligations for the next 30 days

You will watch the ratio diverge. That divergence is the finding.

### 2. Rank reward thresholds vs. MRV depth-1

MRV counts only direct referrals' own purchases, at one level. The OG rank requires 100,000,000 MRV in a single month from direct referrals alone — that is 1,000 purchases of the largest ($100,000) package by directly-sponsored users, in 30 days. Confirm this is intentional and not meant to include team depth; if the top ranks are meant to be reachable, either MRV needs team depth or the thresholds need revisiting.

---

## Part 6 — Open Questions: Resolved

All previously open questions are now confirmed:

1. **Compounding base:** Confirmed **compound interest**. Daily interest accrues on the running Wallet A balance (capital + all profit generated so far), not a fixed month-start base. On Fridays, no interest is calculated at all (not zero-rate, simply skipped).
2. **Friday skip and the monthly divisor:** Confirmed the divisor stays `0.05 / daysInMonth`, and the effective monthly total landing around ~4.3% (with ~4 Fridays skipped) is **accepted as-is** — no adjustment needed to force an exact 5%.
3. **Placement "weaker leg":** Confirmed measured **by accumulated BV**, not member count. Team/member count is irrelevant to placement decisions — the system compares left-leg BV vs. right-leg BV and places the new member under whichever side has less BV.
4. **Multiple packages per user:** Confirmed **yes** — a user can hold several active investments simultaneously, each tracked independently (own `profit_starts_at`, `capital_unlocks_at`, own accrual).
5. **Reinvestment source:** Confirmed **yes** — a user can buy a new package using Wallet B credit regardless of B's funding source (admin credit, profit withdrawal, or commission withdrawal). This purchase generates BV like any other, per the rules doc.
6. **Leg activity definition:** Confirmed a leg is active **only as long as capital exists in Wallet A** somewhere in that leg's subtree. The moment a member's capital is released (withdrawn out of A after the 6-month lock) and no other active capital remains in that subtree, the leg **flips back to inactive**. This is a live/dynamic status, not a permanent flag — it must be re-evaluated whenever capital is released, not just when it's deposited.
7. **Withdrawal from B:** Confirmed — withdrawing out of Wallet B **burns** the amount (removes it from the simulation entirely) and is recorded in the ledger/audit trail so the user can see what happened. This is the system's simulated "exit to the real world."
8. **Capital release:** Confirmed **user-initiated** — after the 6-month lock expires, the capital becomes *eligible* for withdrawal, but the user decides whether and when to actually withdraw it. Capital that stays in A past 6 months presumably keeps earning (see note below).
9. **Rank reward for Partner (trip choice):** Confirmed — if the user picks the trip, it is logged as a **non-cash award** (no ledger credit), same treatment as already planned.

### Follow-on implications to build in

- **Leg activity is now a derived, re-evaluated status**, not a one-way flag. Every capital release event must re-check whether the affected leg (and all its ancestors up the placement tree) still has active capital anywhere in the subtree, and flip `active → inactive` if not. This affects Binary Commission qualification (Phase 8) and needs its own recheck job or trigger, not just an on-write check.
- **Capital that remains in A past 6 months**: since release is user-initiated, unreleased capital presumably continues both existing (as capital) and generating daily interest — confirm this is intended (it follows naturally from "the user decides" and needs no special handling, since nothing forces it out).
- **BV-based weak-leg placement** means the placement algorithm (Phase 7) must query summed BV per subtree at insertion time, not member counts — slightly more expensive than a count check, so consider caching per-node BV totals rather than summing the whole subtree on every new registration.

---

## Part 7 — Security Architecture

"No real money" does not mean no attack surface. The two things actually worth protecting here are: (1) the integrity of the ledger/business logic — someone manipulating their own wallet, commission tree, or rank status — and (2) the admin accounts, since compromising one means unlimited simulated credit issuance. Security work is woven through the phases below, not a separate afterthought.

### SQL Injection
- **Prisma parameterizes every query by default** — this is the primary defense, and it's already the ORM chosen in Part 1. The only risk is raw SQL: if any `$queryRaw`/`$executeRaw` is ever used (e.g. for a complex reconciliation query), it **must** use Prisma's tagged-template form (`$queryRaw\`...${value}...\``), never string concatenation or interpolation into a plain SQL string. Add this as a code-review rule, and grep for `$queryRawUnsafe` / `$executeRawUnsafe` before every deploy — those two functions bypass parameterization entirely and should not appear in the codebase.

### Authentication & Session Security
- Passwords hashed with **argon2id** (preferred over bcrypt for new projects), never reversible encryption
- Session cookies: `httpOnly`, `secure`, `sameSite=strict` — session tokens are never readable by client-side JS (mitigates XSS-driven session theft)
- **Rate limiting on auth endpoints**: login, password reset, and security-question attempts all get per-IP and per-account rate limits (e.g. 5 attempts / 15 min), with exponential backoff or temporary lockout after repeated failures
- **Account lockout**: after N failed login attempts, lock the account temporarily and log the event — visible to admin as a security event, not just a silent failure
- **Mandatory 2FA (TOTP) for all admin and sub-admin accounts** — given that admin accounts control credit issuance and withdrawal approval, this is the single highest-value security control in the whole system. Regular user accounts can have 2FA as optional.
- Session timeout: shorter idle timeout for admin sessions than user sessions (e.g. 30 min admin vs. a few hours user)

### Authorization / IDOR Protection
- **Every API route/server action that touches a wallet, investment, or commission record must verify the requesting user owns that resource** — never trust a client-supplied `user_id` or `investment_id` alone. This is the most common real-world vulnerability class in multi-tenant financial systems (Insecure Direct Object Reference): user A requesting user B's withdrawal history, wallet balance, or investment detail by guessing/incrementing an ID.
- Admin routes re-check the specific `admin_permission_grants` server-side on every request — never rely on the UI simply hiding a button; the underlying route must independently reject unauthorized calls even if someone hits the API directly.
- Server-side re-validation of everything already flagged elsewhere in this plan (Friday-only withdrawal windows, $50 minimums, capital lock expiry) — **never trust client-side checks**, they are UX conveniences only. Every rule in `mlm_rules_log.md` and `wallet_interest_audit_rules_log.md` must be enforced again on the server regardless of what the client sent.

### Input Validation & XSS
- **Zod schemas validate every input server-side** (already in the stack) — reject malformed/oversized input before it reaches business logic
- React auto-escapes rendered content by default; **never use `dangerouslySetInnerHTML`** on any user-supplied text (names, admin comments, withdrawal reasons, etc.)
- Free-text fields (admin comments, security question answers, user names) are length-capped and stripped of control characters at the validation layer

### CSRF
- Next.js server actions include origin-checking by default; additionally verify the `Origin`/`Referer` header server-side on all state-changing requests as defense-in-depth, particularly for the admin panel's financial actions

### Idempotency as a Security Property
- The idempotency-key design (Decision 2) already defends against a specific attack pattern: **double-submission** of a withdrawal request or purchase action (e.g. rapid double-click, replayed request, or a malicious script re-firing a request) cannot create duplicate financial effects, since the database's `UNIQUE` constraint rejects the second attempt outright.

### Secrets & Configuration
- `.env` files never committed to version control; `.env.example` documents required variables without real values
- Distinct secrets per environment (dev/staging/production) — database credentials, session signing keys, etc. never reused across environments
- Database user for the app connection has least-privilege grants (no `DROP`/`ALTER` in production), separate from the migration-runner credential

### Transport & Headers
- HTTPS/TLS terminated at the reverse proxy (Nginx/Caddy, per Phase 13), with HTTP→HTTPS redirect and HSTS enabled
- Security headers via Next.js middleware/config: `Content-Security-Policy`, `X-Frame-Options: DENY` (prevents clickjacking on login/admin screens), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`

### Dependency & Supply Chain
- Lockfile (`package-lock.json`/`pnpm-lock.yaml`) committed and enforced in CI
- `npm audit` (or equivalent) run before each deploy; Dependabot or Renovate enabled on the repo for automated dependency update PRs

### Monitoring & Audit Tie-In
- **Security events feed the same audit system already built for financial events**: failed login attempts, account lockouts, permission changes, admin account creation, and 2FA enrollment/removal all get logged, ideally in the same style as `admin_actions` — the main admin should be able to see "who tried to log into whose account and failed" with the same clarity as "who issued credit to whom."
- The nightly reconciliation job (Phase 12) doubles as an integrity check: if `SUM(ledger) != wallets.balance` for any user, that's as much a potential tampering signal as a bug signal, and should alert loudly either way.

### Where This Lands in the Phases
- **Phase 1**: argon2id hashing, session cookie flags, rate limiting on auth routes, 2FA enrollment for admin/sub-admin accounts
- **Phase 2**: idempotency keys (already specified) double as the double-submission defense
- **Every phase with a server action**: Zod validation + ownership/permission checks, non-negotiable per route
- **Phase 12**: security headers, dependency audit, reconciliation-as-tamper-detection, security event logging
- **Phase 13**: TLS/HSTS, reverse proxy hardening, database least-privilege roles

---

## Part 8 — Working With Claude Code

**Session hygiene:**
- Start every session by pasting/attaching the three docs: this plan + both rules logs
- State the phase number and its exit test up front
- One phase per session — resist scope creep

**Prompt template:**
```
Context: [attach build_plan.md, mlm_rules_log.md, wallet_interest_audit_rules_log.md]

We are on Phase N: [name].
Prerequisite state: Phases 0..N-1 are complete and their tests pass.

Build: [the phase deliverables]
Constraints:
  - All money values use Prisma.Decimal, never JS number
  - Every money movement goes through postTransaction() with an idempotency key
  - Engine functions take date as a parameter, never call new Date() internally
Exit test: [the phase's exit test]

Write the tests first, then the implementation.
```

**Non-negotiable invariants — restate these in every session:**
1. No JS `number` for money. Ever.
2. No ledger UPDATE or DELETE. Corrections are reversing entries.
3. Every generated payout carries a unique idempotency key.
4. Engine functions receive dates as parameters.
5. Sponsor tree and placement tree are separate. Never join them by accident.
6. Business rules (interest rate, commission %, rank thresholds) are read from versioned config tables, never hardcoded constants — and editing a rule never rewrites past calculations.
7. No hard delete on users — suspend/deactivate only.
8. Admin actions are permission-gated per sub-admin, not a single blanket "is admin" check — only the main admin bypasses all checks, and only the main admin can manage other admin accounts.
9. Every server action verifies the requesting user owns the resource being accessed (no IDOR) — never trust a client-supplied user/investment/wallet ID alone.
10. All Prisma raw queries use tagged-template parameterization; `$queryRawUnsafe`/`$executeRawUnsafe` are never used.

**Build order dependency:** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. Phases 10 and 11 can be interleaved with earlier work if you want visual feedback sooner, but they must not precede Phase 2.

---

*Plan generated at the requirements-complete stage. Update as decisions change.*
