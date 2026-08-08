---
name: money-precision
description: Rules for handling monetary values, ledger writes, and idempotency in this project. Use whenever writing or reviewing code that touches a wallet balance, ledger entry, interest calculation, commission payout, rank reward, withdrawal, transfer, or any Prisma model with a Decimal column. Also use when writing tests that assert on financial amounts, or when adding a new scheduled job that moves money.
---

# Money & Precision Rules

This project's audit ledger is the source of truth for a compounding-interest
system running daily for months. Floating-point drift accumulates and the ledger
stops reconciling. These rules are not stylistic.

## 1. No JS `number` for money. Ever.

```ts
// WRONG — irreversible precision loss the moment it happens
const profit = Number(balance) * 0.05 / 30;
const total = amounts.reduce((a, b) => a + b, 0);

// RIGHT
import { Prisma } from '@prisma/client';
const profit = balance.mul(monthlyRate).div(daysInMonth);
const total = amounts.reduce((a, b) => a.add(b), new Prisma.Decimal(0));
```

- DB columns: `@db.Decimal(24, 8)`, i.e. `NUMERIC(24,8)`.
- Application code: `Prisma.Decimal` (decimal.js) end to end.
- Convert to a display string **only at the final render step**, never earlier.
- `Number()`, `parseFloat`, `+value`, `JSON.parse` into a number, and arithmetic
  operators (`+ - * /`) on money are all disallowed. Use `.add() .sub() .mul()
  .div()`.
- Comparisons use `.eq() .gt() .gte() .lt() .lte()`, never `===` or `>`.

## 2. Display formatting

- Round-half-up to 2 decimal places for display: a stored `104.99500000` displays
  as `105.00`.
- Display rounding never mutates the stored value. The 8-decimal value stays exact
  in the database and the ledger regardless of what is shown on screen.
- Use the shared `toDisplay(d)` helper. Do not hand-roll formatting per component.
- Always Western Arabic numerals (0–9), in both English and Arabic locales.

## 3. Every money movement goes through `postTransaction`

```ts
await postTransaction({
  entries: [
    { userId, wallet: 'B', direction: 'DEBIT',  amount, entryType: 'PACKAGE_PURCHASE', comment: '...' },
    { userId, wallet: 'A', direction: 'CREDIT', amount, entryType: 'PACKAGE_PURCHASE', comment: '...' },
  ],
  idempotencyKey: `purchase:${investmentId}`,
});
```

- Debits must equal credits. `postTransaction` validates this and rejects if not.
- Entries + cached balance updates happen in **one DB transaction**.
- **No single-sided writes exist in this system**, including money entering or
  leaving the simulation. Money entering: CREDIT user's B / DEBIT `SYSTEM_EXTERNAL`.
  Money leaving (B-exit burn): DEBIT user's B / CREDIT `SYSTEM_EXTERNAL`.
- `amount` is always positive; direction carries the sign.
- Never write to `ledger_entries` directly. Never `UPDATE` or `DELETE` a ledger
  entry. Corrections are new reversing entries.
- `wallets.balance` is a cache for read performance, not truth. Never treat it as
  authoritative; never update it outside `postTransaction`.

## 4. Idempotency keys are mandatory and deterministic

Every generated payout carries a unique key, enforced by a `UNIQUE` DB constraint —
this is what makes double-payment impossible at the database level rather than
merely unlikely. Established formats:

```
daily_interest:{user_id}:{investment_id}:{YYYY-MM-DD}
binary:{user_id}:{cycle_week_start}
rank_reward:{user_id}:{rank}
direct:{investment_id}
```

Keys must be derivable from the inputs alone — never include a timestamp, random
value, or UUID generated at call time, or re-running the job silently double-pays.
Re-running any job must always be safe.

## 5. Every entry needs a comment

- System-generated entries auto-fill it: "Daily interest for Investment #123, day 14".
- Admin-issued actions require the admin to type a reason before submitting. The
  action cannot proceed without one. Store it on both the ledger entry and
  `admin_actions`.

## 6. Engine functions take dates as parameters

```ts
// WRONG
function dailyRate() { const d = new Date(); ... }

// RIGHT
function dailyRate(forDate: Date): Prisma.Decimal { ... }
```

The scheduler passes real dates; tests pass fabricated ones; same code path. This
lets the test suite verify a simulated year in seconds. No business-logic function
calls `new Date()` internally.

## 7. Rates come from versioned config, never constants

Interest rate, commission rates and splits, rank thresholds and rewards are all
read from their config tables by looking up "which row was active on that date."
Never hardcode `0.05` or `0.08`. Editing a config row closes the old row's validity
window and inserts a new one — it never overwrites, because that would silently
rewrite history the immutable ledger has already recorded.

## 8. Testing financial code

- Assert to 8 decimal places, not 2.
- Compare with `.eq()` on Decimals, never `toBe()` on converted numbers.
- Always include a re-run test: calling the same operation twice with the same
  idempotency key must produce exactly one set of entries.
- Always include a reconciliation assertion: `SUM(ledger) === wallets.balance`.
