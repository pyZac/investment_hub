# Investment Webapp Simulation — MLM Rules Log

> **Context**: This is a fully internal, simulated system. No real payment gateways, no real money — all values are made-up digits for experimentation purposes only. This document is the single source of truth for the platform's business logic. Refer back here if context is lost in later discussions.

---

## 1. Wallet System

The system has **4 wallets per user** (3 primary + 1 sub-wallet):

| Wallet | Name | Purpose |
|--------|------|---------|
| **A** | Investment Wallet | Holds capital + accrued compound interest from packages |
| **B** | Internal Wallet | Liquidity wallet. Receives self-service transfers from A and C. Also the only wallet admin can credit directly (the sole source of new money entering the simulation), and the only wallet a user can withdraw *out of* the simulation from (with admin approval — see `wallet_interest_audit_rules_log.md`). |
| **C** | Commission Wallet | Holds Direct, Binary, and Ranking commissions. Self-service transfer to B. |
| **SAVING** | Saving sub-wallet (under C) | Holds the locked 3% portion of Direct Commission until its 3-month lock expires, then releases into C. |

- A → B and C → B: self-service internal transfers, Fridays only, no admin approval
- Out of B: requires admin approval (the platform's simulated "exit"); no maximum cap, $50 minimum
- Full withdrawal mechanics, minimums, and the admin-approval flow live in `wallet_interest_audit_rules_log.md` — this file covers only the MLM/commission logic.

---

## 2. Investment Packages

- **7 fixed tiers only** — no custom investment amounts. Full tier list (names/amounts) lives in `wallet_interest_audit_rules_log.md`.
- Users buy a package with Wallet B credit → capital deposited/tracked in Wallet A
- Packages earn **monthly compound interest**, accrued daily in Wallet A — full interest mechanics (rate, daily distribution, Friday pause, 7-day delay, 6-month lock) live in `wallet_interest_audit_rules_log.md`
- **The interest rate is a single global value, admin-editable, applied uniformly to every user's active investments at any given time** — not locked per package or per investment. See the build plan (Decision 4) for how rate changes are versioned.
- A user can hold **multiple active investments simultaneously**, each tracked with its own purchase date, profit-start date, and capital-unlock date
- Reinvestment (buying a new package using Wallet B credit sourced from profit or commission withdrawals) is fully allowed, and counts as a normal purchase for Binary Volume and MRV purposes

---

## 3. Commission Systems Overview

Three **independent** systems, each with different tree logic:

| System | Tree Logic | Depth |
|--------|-----------|-------|
| Direct Commission | Sponsor-based | 1 level (direct sponsor only) |
| Binary Commission | Placement-based (binary tree) | Unlimited depth, rolls up through all ancestors |
| Ranking Commission | Sponsor-based | 1 level only (direct referrals' own volume only, no sub-depth) |

**Important distinction**: *Direct sponsor* (who invited/referred the user) is **not necessarily the same** as *binary placement* (where the user sits in the binary tree). A user can be sponsored by one person but placed under a different one in the binary tree due to spillover.

---

## 4. Direct Commission

- **Rate**: 8% (admin-editable, versioned — see build plan Decision 4), applies only to the **direct sponsor** (1 level, no upline beyond that)
- Trigger: **every** package purchase by a directly-sponsored user, not just their first. (Changed 2026-09-24 — previously first-purchase-only; the rule now pays Direct Commission on every qualifying purchase, including reinvestments.)
- Split of the 8%:
  - **5%** → Commission Wallet (C) — immediately available
  - **3%** → Saving sub-wallet (under C) — **locked for 3 months**, then withdrawable to Wallet B

---

## 5. Binary Commission

- **Rate**: 8% (admin-editable, versioned — see build plan Decision 4; historical weeks always use the rate that was active during that specific week), calculated on the **weaker leg's volume only**

### Qualification (to be paid)
A user needs, at the time of calculation:
- Active investment (themselves)
- Active left leg
- Active right leg

A leg is **"active"** as soon as *any* member anywhere within that leg's subtree currently holds capital in Wallet A — does not need to be a direct child. This is a **live, dynamic status**, not a one-time flag: if that member later releases their capital (after the 6-month lock) and no one else active remains in the subtree, the leg flips back to **inactive**. The same is true if an admin suspends a user — their leg (and any leg they're part of, up the tree) is treated as inactive until they're reinstated. Activating a leg does not by itself guarantee payment; the user still needs **both** legs active to qualify.

### Cycle
- Weekly: **Saturday start → Friday close**
- Volume resets weekly
- Paid weekly, 100% immediately available (no lock, unlike Direct Commission's 3%)

### Binary Volume (BV) Definition
**Generates volume:**
- New package purchases
- Reinvestment package purchases

**Does NOT generate volume:**
- Profits
- Bonus credits
- Direct commissions
- Binary commissions
- Rank rewards
- Transfers / wallet movements

### Tree & Placement Logic
- Each user has their own independent binary tree (left leg / right leg)
- New members are placed via **spillover**: system finds the first available slot in the **weaker leg**, searching down from the referrer (not necessarily directly under the referrer). If legs are equal, either side is fine.
- A purchase by any downline member generates BV that rolls up through **every ancestor's** binary tree simultaneously — not just the immediate parent.
- Sponsor (Direct Commission) ≠ Placement (Binary tree position) — confirmed intentional.

### Weak Leg Calculation Example
```
Left Team  = 15,000 BV
Right Team = 7,000 BV
Weak Leg   = 7,000 BV
Commission = 8% of 7,000
```

### Carry Forward
- The **matched volume** (= the weaker leg's amount) is consumed on **both** sides.
- The **weaker leg resets to 0** after matching.
- The **stronger leg's leftover** (unmatched excess) carries forward to the next week.

**Example**: Left = 15,000, Right = 7,000 → commission paid on 7,000 → next week: Left starts at **8,000** (carried over), Right starts at **0**.

### Carry Forward Expiry
- If one leg's carried volume sits unmatched for longer than a configured expiry window (**default 6 months**, admin-editable), the stale portion is dropped rather than continuing to carry forward indefinitely. This prevents a permanently one-sided tree from accumulating an unbounded backlog while waiting for a weak leg that may never activate.
- The expiry clock resets any time that side fully matches down to 0 (i.e., only *continuously unmatched* volume ages out — a leg that gets matched occasionally never expires).

### Worked Example (Placement & Qualification)
- Saher sponsors Zac (placed left leg) and Hiba (placed right leg). Both are active → Saher has 2 active legs, qualifies for binary commission.
- A new member (Sam) is placed automatically under the weaker leg — say, under Zac.
- Sam buys a $10,000 package:
  - Zac's leg (wherever Sam landed) becomes **active** and receives 10,000 BV — but Zac only has **1 active leg** so far (his other leg has nobody active yet) → Zac does **not** qualify for binary commission yet, even though BV is accumulating.
  - Saher, however, now has BV rolling up into his left leg (via Zac → Sam) and already has 2 active legs → Saher **does** qualify and gets paid on that volume.

---

## 6. Ranking Commission (Leadership Ranks)

### Core Rules
- Ranks are **permanent** — no downgrade
- Reward is paid **once only per rank, ever** (re-crossing the threshold in a later month does not re-trigger payment)
- All requirements (MRV + direct referral count) must be achieved **within the same calendar month**
- If a user crosses multiple rank thresholds in the same month, **only the highest newly-achieved rank's reward is paid** (lower ranks in between are not separately paid)

### Monthly Rank Volume (MRV)
- Definition: total investment volume generated **by the user's direct referrals' own personal purchases** during a calendar month
- **Every purchase counts** — new purchases and reinvestments alike, with no first-purchase-only restriction. (Direct Commission, Section 4, also now pays on every purchase as of 2026-09-24 — previously the two systems intentionally used different triggers, with Direct Commission first-purchase-only; that distinction no longer applies.)
- **Depth = 1 level only** — a direct referral's own downline purchases do NOT count toward the sponsor's MRV (no sub-tree depth, unlike Binary Commission's roll-up logic)
- Resets to 0 every month, **no carry forward**
- Independent from Binary Volume (BV) — separate tracking

### Qualified Direct Referral
Must be:
- Personally sponsored by the user
- Holding an active investment

### Rank Requirements

*(Admin-editable per rank — thresholds, referral counts, and reward amounts can all be changed via the admin panel, versioned so already-granted ranks/rewards are never retroactively affected. See build plan Decision 4. Values below are the current/seed configuration.)*

| Rank | MRV Required | Direct Referrals | Reward |
|------|--------------|-------------------|--------|
| Investor | 25,000 | 2 | $500 |
| Partner | 100,000 | 4 | Luxury Trip **or** $2,000 (user's choice) |
| Executive | 500,000 | 6 | $10,000 |
| Director | 2,000,000 | 8 | $40,000 |
| President | 7,500,000 | 10 | $150,000 |
| Chairman | 20,000,000 | 12 | $400,000 |
| Visionary | 50,000,000 | 15 | $1,000,000 |
| OG | 100,000,000 | 20 | $2,000,000 |

All ranks also require: active investment (by the user themselves).

### Reward Payment Timing
- Rank is granted **immediately** upon qualifying
- Reward is credited on the **next Friday processing cycle**
- Reward credited to **Wallet C** (Commission Wallet)
- **Fully available immediately** — no 3-month saving split (unlike Direct Commission's 3%)

---

## 7. Account Creation

Three paths, all covered in the build plan (Phase 1):
- **Self-registration with a sponsor referral code** — standard path, places the new user in the sponsor tree
- **Self-registration with no code** — becomes a new tree root (both sponsor tree and placement tree); intended for the first user in practice
- **Admin-created accounts** — the main admin or a sub-admin with `USER_MANAGEMENT` permission can create a user account directly on someone's behalf

---

*(This document's prior "Open Items" section has been fully resolved — package structure, interest mechanics, reinvestment rules, and withdrawal rules are now specified in `wallet_interest_audit_rules_log.md`; tech stack and architecture are specified in `build_plan.md`.)*

---

*Document generated as a running log of confirmed decisions. Update this file as new rules are clarified or changed.*
