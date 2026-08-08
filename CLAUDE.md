# CLAUDE.md — Investment Webapp Simulation

This file is auto-loaded by Claude Code at the start of every session. It is the
single persistent memory of this project. The three reference documents below are
the source of truth for *what* to build; this file governs *how* to work.

**Project nature**: fully internal, closed simulation. No real payment gateways, no
external APIs, no real money — every value is a simulated digit. Admin credit
issuance to Wallet B is the only source of funds entering the system. Bilingual
(English/Arabic, RTL) dashboard, deployed via Docker Compose.

## Reference documents — read only what the current phase needs

Do NOT read all three cover-to-cover every session — each phase brief in
`/docs/phases/` tells you exactly which sections apply. Full docs:

- `/docs/build_plan.md` — tech stack, architecture decisions, data model, phase list
- `/docs/mlm_rules_log.md` — Direct/Binary/Ranking commission rules
- `/docs/wallet_interest_audit_rules_log.md` — packages, interest, withdrawals, audit

## Session start checklist

1. Read the phase brief in `/docs/phases/phase-NN-*.md` for the phase you're told to work on.
2. Read `/tasks/lessons.md` in full — it's short, and it exists to stop you repeating past mistakes.
3. Confirm prerequisite phases are complete (their exit tests passed) before writing code.
4. Write `/tasks/todo.md` as a checklist for this session before starting implementation. Check items off as you go.
5. Write tests first, then implementation.
6. Do not mark the phase's Exit Test complete without actually running it and showing the result.

## The 10 non-negotiable invariants

These apply to every phase, no exceptions:

1. No JS `number` for money, ever. Use `Prisma.Decimal` end to end; convert to a display string only at the last render step.
2. No ledger `UPDATE` or `DELETE`. Corrections are new reversing entries.
3. Every generated payout carries a unique idempotency key (`UNIQUE` DB constraint).
4. Engine functions receive dates as parameters — never call `new Date()` internally inside business logic.
5. Sponsor tree (`users.sponsor_id`) and placement tree (`binary_nodes`) are separate. Never join them by accident.
6. Business rules (interest rate, commission %, rank thresholds) are read from versioned config tables, never hardcoded constants. Editing a rule never rewrites past calculations.
7. No hard delete on users — suspend/deactivate only.
8. Admin actions are permission-gated per sub-admin (`admin_permission_grants`), not a blanket "is admin" check. Only the main admin bypasses all checks and only the main admin manages other admin accounts.
9. Every server action verifies the requesting user owns the resource being accessed (no IDOR) — never trust a client-supplied user/investment/wallet ID alone.
10. All Prisma raw queries use tagged-template parameterization. `$queryRawUnsafe`/`$executeRawUnsafe` are never used.

## Workflow discipline

**Plan before building.** For anything touching more than one file or an
architectural decision, write the plan to `/tasks/todo.md` first and pause for
confirmation before implementing — don't barrel ahead on a guess.

**If something goes wrong, stop and re-plan.** Don't keep patching a failing approach.

**Verify before declaring done.** Never mark a task or an Exit Test complete without
actually running it and showing the output. "Would a senior engineer sign off on
this?" is the bar — not "does this look plausible."

**Elegance over the first thing that works, but don't over-engineer.** For
non-trivial changes, pause and ask whether there's a cleaner way before committing
to the first working version. Skip this for trivial, obvious fixes.

**Simplicity and minimal blast radius.** Touch only what the phase requires. Find
root causes rather than patching symptoms. No temporary fixes.

**Capture corrections.** Any time the user corrects you, append a short entry to
`/tasks/lessons.md` describing the mistake and the rule that would have prevented
it — before continuing with the task. Keep this file short and skimmable; prune
anything that's now redundant with a standing rule elsewhere.

## Precision & formatting conventions

- DB storage: `NUMERIC(24,8)` for every monetary column.
- Display: round-half-up to 2 decimal places, Western Arabic numerals (0–9) in both locales — never Eastern Arabic numerals, even in the Arabic UI.
- Financial terminology (Wallet A/B/C, Binary Commission, BV, Rank, package names) stays in English even in the Arabic UI. Only general interface text, labels, and navigation are translated.
- Business timezone: `Asia/Dubai` (UTC+4, fixed offset, no DST) — set as a named timezone in config, not a raw offset.
- Internal system counterparty account name is `SYSTEM_EXTERNAL` in code/schema; always displayed to admins as **"Platform Reserve"**.

## Build order

Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13, strictly
sequential — a phase does not start until the previous phase's Exit Test has
passed and been confirmed by the user in the operation-room chat. Phases 10 and
11 may be interleaved with earlier phases for visual feedback, but never before
Phase 2.

## What NOT to do

- Don't paste the full contents of `/docs/*.md` back into chat responses — reference sections, don't reproduce them.
- Don't invent business rules not in `/docs/`. If something is genuinely ambiguous, stop and ask rather than guessing — this project's owner prefers resolving ambiguity before implementation, not after.
- Don't scope-creep into the next phase's deliverables even if it seems convenient to do "while you're in there."
