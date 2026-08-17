# Investment Webapp Simulation — Wallet, Interest & Audit Rules Log

> **Context**: Fully internal, simulated system. No real payment gateways, no real money — all values are made-up digits for experimentation purposes only. This document is a companion to `mlm_rules_log.md` (which covers Direct/Binary/Ranking commissions). This file covers Packages, Wallet A/B mechanics, interest calculation, withdrawal rules, and audit/precision requirements.

---

## 1. Investment Packages

- **Fixed tiers only** — no custom investment amounts
- **Interest rate**: currently **5% per month** — this is a single global value (not per-package, not per-investment), admin-editable, applying uniformly to every user's active investments at any given time. A rate change takes effect for everyone starting the next day's calculation, with no grandfathering of investments at an old rate. See the build plan (Decision 4) for the full versioning design.

### Package Tiers

| Tier Name | Amount |
|-----------|--------|
| Starter | $100 |
| Bronze | $500 |
| Silver | $1,000 |
| Gold | $5,000 |
| Platinum | $10,000 |
| Diamond | $50,000 |
| Elite | $100,000 |

*(Names are placeholders — rename freely, values are fixed as given.)*
- **Capital lock**: capital is locked for **6 months** from purchase date. After 6 months, capital becomes withdrawable (separate flow from profit withdrawals)
- **Profit start delay**: interest accrual does **not** begin until **7 days** after purchase date. Days 1–7: no profit. Day 8 onward: daily interest begins accruing.

---

## 2. Interest Calculation (Wallet A)

- Interest is **5% per month** (current global rate, admin-editable — see Section 1), but distributed **daily**:
  - Daily rate = current monthly rate ÷ (number of days in the current calendar month, excluding Fridays)
  - This means the full monthly rate is realized by month's end, since Fridays are
    genuinely paused rather than causing a shortfall — this was a deliberate decision,
    not the platform's original default. Do not change this divisor without an
    explicit decision logged here.
  - Each day, that daily slice is credited into Wallet A
  - Purpose: user sees visible daily profit growth (motivational UX)
- **Interest base** = current balance in Wallet A (capital + all profit accrued so far)
  - If user withdraws profit out of A (A→B), the withdrawn amount is removed from A
  - All **subsequent** daily interest is calculated on the **new, reduced** Wallet A balance
- **Fridays**: interest accrual is **paused**. Fridays are reserved exclusively for withdrawal actions (see below). Accrual resumes Saturday.

---

## 3. Withdrawals

Two distinct withdrawal mechanisms — do not conflate them:

### a) Internal transfers: A → B and C → B
| Rule | Detail |
|------|--------|
| Approval | **None required** — fully self-service, processes instantly |
| Timing | **Fridays only** |
| Minimum | None (the $50 minimum applies only to the B-exit below) |
| Fees | None |
| Source | Wallet A (profit only, while capital is locked) and Wallet C (commission, minus anything still in SAVING) |

### b) Exit withdrawal: out of Wallet B (the "burn")
| Rule | Detail |
|------|--------|
| Approval | **Requires admin approval** — user submits a request, it sits pending until an admin approves or rejects it |
| Timing | **Fridays only** for the user's request; admin can approve on any day once submitted |
| Minimum | **$50 minimum** |
| Fees | None |
| Effect on approval | Amount is burned (removed from the simulation) and recorded against the system counterparty account ("Platform Reserve" / `SYSTEM_EXTERNAL`) — see the ledger system note below |
| Effect on rejection | No funds move; the request is marked rejected with the admin's reason, funds remain in Wallet B |

Capital withdrawal (releasing the 6-month-locked principal from Wallet A into B) is a separate action from both of the above — see below.

### c) Capital release: A → B (principal only, after lock expiry)
- Only after the **6-month capital lock** expires; user-initiated, not automatic
- Once released, the investment stops earning (status → `CAPITAL_RELEASED`)
- Follows the same **Friday-only, self-service** rule as (a) above — no separate admin approval needed for releasing capital itself; approval is only required at the final Wallet B exit step (b)
- Profit (accrued interest) is withdrawable separately from capital, per (a), starting once past the 7-day profit-delay window, even while capital is still locked

**System counterparty account**: behind the scenes, every credit issued by an admin and every amount burned on withdrawal out of Wallet B is recorded against a system-level account (internally `SYSTEM_EXTERNAL`, shown to admins under a friendly label like "Platform Reserve"). This keeps the audit ledger fully double-entry (nothing appears or disappears without a matching opposite entry) and gives the admin a single running total of how much simulated money has entered vs. left the platform.

**Account suspension**: if an admin suspends a user, everything freezes immediately — no further daily interest accrues on their investments, no commissions are generated by or credited to them, and any binary leg containing them (in either direction — as a member of someone else's leg, or their own legs) is treated as inactive until the user is reinstated. This is a full financial freeze, not just a login block.

---

## 4. Accounting & Audit

- **Permanent, immutable audit history** — nothing is ever deleted or overwritten
- Must record every instance of:
  - Deposits
  - Withdrawals
  - Transfers (wallet-to-wallet)
  - Profit calculations (daily interest credits)
  - Commission credits (Direct / Binary / Ranking)
  - Rank rewards
  - Administrative financial actions (manual admin adjustments, corrections, etc.)
- **Every recorded transaction must be fully clear at a glance**, showing at minimum:
  - **Date/time** of the transaction
  - **Transaction type** (readable label — e.g. "Daily Interest", "Direct Commission", "Admin Credit", "Withdrawal")
  - **User's name** (or "Platform Reserve" for the system counterparty side — see wallet system note below)
  - **Amount**
  - **Comment/note** — a human-readable explanation. System-generated entries (interest, commissions, rank rewards) auto-fill this. Admin-issued actions (credit issuance, manual adjustments) require the admin to type a reason before the action can be submitted.

### Precision
- **Database storage**: 8 decimal places for all monetary/numeric values (exact, never floating-point)
- **User-facing display**: rounded to **2 decimal places** using **standard rounding (round-half-up)** — e.g. a stored value of $104.99500000 displays as $105.00. This is a display-only conversion; the full 8-decimal value remains exact in the database and the ledger regardless of what's shown on screen.
- **No caps on withdrawal amounts** — the $50 figure above is a minimum only; there is no maximum limit on how much can be withdrawn in a single request or per Friday.

---

## 5. Open Items / Not Yet Defined

*(none currently — all items previously listed here have been resolved and folded into the sections above)*

---

*Document generated as a running log of confirmed decisions. Update this file as new rules are clarified or changed. See `mlm_rules_log.md` for Direct/Binary/Ranking commission rules.*
