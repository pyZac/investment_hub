# Investment Webapp Simulation

A fully internal, closed simulation of an MLM-style investment platform. No real
payment gateways, no external APIs, no real money — every value is a simulated
digit. Admin credit issuance to Wallet B is the only source of funds entering the
system. Bilingual (English / Arabic, RTL), deployed via Docker Compose.

Purpose: experimental and educational.

## Documentation structure

```
CLAUDE.md                     ← auto-loaded by Claude Code every session; the
                                 workflow rules and the 10 invariants
README.md                     ← this file

docs/
├── build_plan.md             ← tech stack, architecture decisions, data model
├── mlm_rules_log.md          ← Direct / Binary / Ranking commission rules
├── wallet_interest_audit_rules_log.md
│                             ← packages, interest, withdrawals, audit, precision
├── SESSION_PROMPTS.md        ← ready-to-paste kickoff prompt for each phase
└── phases/
    ├── phase-00-foundation.md
    ├── phase-01-auth-users.md
    ├── phase-02-ledger-wallets.md      ← most important phase
    ├── phase-03-packages-purchase.md
    ├── phase-04-daily-interest.md
    ├── phase-05-withdrawals.md
    ├── phase-06-direct-commission.md
    ├── phase-07-placement-tree-bv.md
    ├── phase-08-binary-cycle.md
    ├── phase-09-mrv-ranking.md
    ├── phase-10-user-dashboard.md
    ├── phase-11-admin-panel.md
    ├── phase-12-audit-security.md
    └── phase-13-deployment.md

tasks/
├── todo.md                   ← rewritten each session; the working checklist
└── lessons.md                ← append-only record of corrections, read every session

.claude/skills/
├── money-precision/SKILL.md  ← Decimal, ledger, idempotency rules
└── bilingual-rtl/SKILL.md    ← next-intl and RTL conventions
```

## How the three layers relate

The three documents in `docs/` are the **source of truth for what to build** — they
are the specification, refined over planning, and they don't change except by
deliberate decision.

The **phase briefs** in `docs/phases/` are working documents derived from that
spec: each one is self-contained, tells Claude Code exactly which spec sections to
read, and ends with the exit test that gates the next phase. This is what makes a
session efficient — Claude Code reads one focused brief, not three long documents.

`CLAUDE.md` governs **how to work**: the invariants, the plan-first discipline, the
verification standard.

## Working rhythm

1. Phase planning and review happens in a separate "operation room" chat, not in
   Claude Code.
2. One phase = one fresh Claude Code session, using the matching prompt from
   `docs/SESSION_PROMPTS.md`.
3. Claude Code writes `tasks/todo.md` first and shows it before implementing.
4. Tests first, then implementation.
5. The exit test is run and its output shown. Nothing is marked complete on
   inspection alone.
6. Exit test confirmed in the operation room → next phase opens.

Phases are strictly sequential: 0 → 1 → 2 → … → 13. Phases 10 and 11 may be pulled
forward for visual feedback, but never before Phase 2.

## The 10 invariants

See `CLAUDE.md`. They are restated in every session and apply to every phase.
